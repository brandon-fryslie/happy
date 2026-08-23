import { describe, expect, it } from 'vitest';
import {
    getAvailableModels,
    getAvailablePermissionModes,
    getClaudeModelModes,
    getCodexModelModes,
    getClaudePermissionModes,
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
});
