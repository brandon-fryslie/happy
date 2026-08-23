import { describe, expect, it } from 'vitest';
import {
    getAvailableModels,
    getAvailablePermissionModes,
    getClaudeModelModes,
    getCodexModelModes,
    getClaudePermissionModes,
    getDefaultEffortKeyForModel,
    getEffortLevelsForModel,
    mapMetadataOptions,
    resolveCurrentOption,
} from './modelModeOptions';

const translate = (key: string) => `tr:${key}`;

describe('modelModeOptions', () => {
    it('maps metadata option shape into mode options', () => {
        expect(mapMetadataOptions([
            { code: 'm1', value: 'Model One', description: 'Primary model' },
            { code: 'm2', value: 'Model Two' },
        ])).toEqual([
            { key: 'm1', name: 'Model One', description: 'Primary model' },
            { key: 'm2', name: 'Model Two', description: null },
        ]);
    });

    it('builds claude permission fallbacks with translated names', () => {
        const modes = getClaudePermissionModes(translate);
        expect(modes.map((mode) => mode.key)).toEqual(['default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions']);
        expect(modes[0].name).toBe('tr:agentInput.permissionMode.default');
    });

    it('builds codex model fallbacks', () => {
        const models = getCodexModelModes();
        expect(models.map((model) => model.key)).toEqual([
            'default',
            'gpt-5.4',
            'gpt-5.3-codex',
            'gpt-5.2-codex',
            'gpt-5.1-codex-max',
            'gpt-5.2',
            'gpt-5.1-codex-mini',
        ]);
        expect(models[0].name).toBe('default model');
        expect(models[1].name).toBe('gpt-5.4');
    });

    describe('claude model fallbacks', () => {
        // The key is what reaches the Claude CLI's `--model`. An entry whose key
        // is a bare tier alias delegates the choice of model to the CLI, so a
        // label naming a version would be claiming to know an answer this list
        // does not have — the exact staleness that made the old list wrong.
        it('labels tier aliases without a version', () => {
            const aliases = getClaudeModelModes().filter(
                (model) => model.key === 'opus' || model.key === 'sonnet' || model.key === 'haiku',
            );

            expect(aliases.map((model) => model.key)).toEqual(['opus', 'sonnet', 'haiku']);
            for (const alias of aliases) {
                expect(alias.name).not.toMatch(/\d/);
            }
        });

        it('offers the current roster as pinnable model ids', () => {
            const keys = getClaudeModelModes().map((model) => model.key);

            expect(keys).toEqual(expect.arrayContaining([
                'claude-fable-5',
                'claude-opus-5',
                'claude-opus-4-8',
                'claude-opus-4-7',
                'claude-opus-4-6',
                'claude-sonnet-5',
                'claude-sonnet-4-6',
                'claude-haiku-4-5',
            ]));
        });

        // A pinned key names the model that runs, so its label can be checked
        // against the key rather than against a roster that moves.
        it('labels pinned entries with the version their key selects', () => {
            const pinned = getClaudeModelModes().filter((model) => model.key.startsWith('claude-'));

            expect(pinned.length).toBeGreaterThan(0);
            for (const model of pinned) {
                expect(model.key).toBe(`claude-${model.name.replace(/[ .]/g, '-')}`);
            }
        });

        it('starts with the default option and lists each key once', () => {
            const keys = getClaudeModelModes().map((model) => model.key);

            expect(keys[0]).toBe('default');
            expect(new Set(keys).size).toBe(keys.length);
        });

        it('falls back to the claude list when metadata carries no models', () => {
            expect(getAvailableModels('claude', { models: [] } as any, translate))
                .toEqual(getClaudeModelModes());
        });
    });

    it('prefers metadata models over hardcoded fallbacks', () => {
        const models = getAvailableModels('gemini', {
            models: [
                { code: 'custom-gemini', value: 'Gemini Custom', description: 'From metadata' },
            ],
        } as any, translate);

        expect(models).toEqual([
            { key: 'custom-gemini', name: 'Gemini Custom', description: 'From metadata' },
        ]);
    });

    it('adds codex default model option when metadata models are present', () => {
        const models = getAvailableModels('codex', {
            models: [
                { code: 'gpt-5.4', value: 'gpt-5.4', description: 'Latest' },
            ],
        } as any, translate);

        expect(models).toEqual([
            { key: 'default', name: 'default model', description: null },
            { key: 'gpt-5.4', name: 'gpt-5.4', description: 'Latest' },
        ]);
    });

    it('leads with the claude roster the CLI published', () => {
        const models = getAvailableModels('claude', {
            models: [
                { code: 'default', value: 'Default (recommended)', description: 'Opus 4.6 · Most capable' },
                { code: 'haiku', value: 'Haiku', description: 'Haiku 4.5 · Fastest' },
            ],
        } as any, translate);

        expect(models.slice(0, 2)).toEqual([
            { key: 'default', name: 'Default (recommended)', description: 'Opus 4.6 · Most capable' },
            { key: 'haiku', name: 'Haiku', description: 'Haiku 4.5 · Fastest' },
        ]);
    });

    it('keeps pinned claude versions selectable alongside the published roster', () => {
        const models = getAvailableModels('claude', {
            models: [{ code: 'default', value: 'Default (recommended)', description: null }],
        } as any, translate);

        expect(models.some((model) => model.key === 'claude-opus-5')).toBe(true);
    });

    it('does not offer a pinned claude version the published roster already lists', () => {
        const models = getAvailableModels('claude', {
            models: [
                { code: 'default', value: 'Default (recommended)', description: null },
                { code: 'claude-opus-5', value: 'Opus 5', description: 'From the CLI' },
            ],
        } as any, translate);

        expect(models.filter((model) => model.key === 'claude-opus-5')).toEqual([
            { key: 'claude-opus-5', name: 'Opus 5', description: 'From the CLI' },
        ]);
    });

    it('keeps codex permission modes hardcoded even when metadata modes exist', () => {
        const modes = getAvailablePermissionModes('codex', {
            operatingModes: [{ code: 'metadata-only', value: 'Metadata Mode', description: null }],
        } as any, translate);

        expect(modes.map((mode) => mode.key)).toEqual(['default', 'read-only', 'safe-yolo', 'yolo']);
    });

    it('applies hacks to metadata-provided operating modes', () => {
        const modes = getAvailablePermissionModes('gemini', {
            operatingModes: [
                { code: 'build', value: 'build, build', description: 'Do build steps' },
                { code: 'plan', value: 'plan/plan', description: 'Plan first' },
            ],
        } as any, translate);

        expect(modes).toEqual([
            { key: 'build', name: 'Build', description: 'Do build steps' },
            { key: 'plan', name: 'Plan', description: 'Plan first' },
        ]);
    });

    it('resolves the first matching preferred key', () => {
        const options = [
            { key: 'a', name: 'A' },
            { key: 'b', name: 'B' },
        ];

        expect(resolveCurrentOption(options, ['missing', 'b', 'a'])).toEqual({ key: 'b', name: 'B' });
        expect(resolveCurrentOption(options, ['missing'])).toBeNull();
    });

    describe('default effort level', () => {
        it('starts claude sessions on high rather than the top of the ladder', () => {
            expect(getDefaultEffortKeyForModel('claude', 'default')).toBe('high');
        });

        it('starts codex sessions on xhigh', () => {
            expect(getDefaultEffortKeyForModel('codex', 'default')).toBe('xhigh');
        });

        it('has no default where there is no effort ladder', () => {
            expect(getDefaultEffortKeyForModel('gemini', 'gemini-2.5-pro')).toBeNull();
            expect(getEffortLevelsForModel('gemini', 'gemini-2.5-pro')).toEqual([]);
        });

        // The default used to be read off the end of the ladder, which meant
        // appending a level moved it. These two assertions are what tell those
        // rules apart: the default has to be a level that exists, and for claude
        // it has to be one the list order would not have picked.
        it.each(['claude', 'codex'] as const)('defaults to a level that is on the %s ladder', (flavor) => {
            const levels = getEffortLevelsForModel(flavor, 'default');
            const defaultKey = getDefaultEffortKeyForModel(flavor, 'default');

            expect(levels.map((level) => level.key)).toContain(defaultKey);
        });

        it('does not read the claude default off the end of the ladder', () => {
            const levels = getEffortLevelsForModel('claude', 'default');

            expect(getDefaultEffortKeyForModel('claude', 'default')).not.toBe(levels[levels.length - 1].key);
        });

        it('offers xhigh on the claude ladder, between high and max', () => {
            const keys = getEffortLevelsForModel('claude', 'default').map((level) => level.key);

            expect(keys).toContain('xhigh');
            expect(keys.indexOf('high')).toBeLessThan(keys.indexOf('xhigh'));
            expect(keys.indexOf('xhigh')).toBeLessThan(keys.indexOf('max'));
        });

        it('names every effort level after its own key', () => {
            for (const flavor of ['claude', 'codex'] as const) {
                for (const level of getEffortLevelsForModel(flavor, 'default')) {
                    expect(level.name).toBe(level.key);
                }
            }
        });
    });
});
