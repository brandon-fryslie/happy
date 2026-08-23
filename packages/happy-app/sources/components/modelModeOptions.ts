import type { Metadata } from '@/sync/storageTypes';
import { hackModes } from '@/sync/modeHacks';

export type ModeOption = {
    key: string;
    name: string;
    description?: string | null;
};

export type PermissionMode = ModeOption;
export type ModelMode = ModeOption;

export type EffortLevel = ModeOption;
export type PermissionModeKey = string;
export type ModelModeKey = string;

export type AgentFlavor = 'claude' | 'codex' | 'gemini' | string | null | undefined;

type Translate = (key: any) => string;

type MetadataOption = {
    code: string;
    value: string;
    description?: string | null;
};

const GEMINI_MODEL_FALLBACKS: ModelMode[] = [
    { key: 'gemini-3.1-pro-preview', name: 'gemini 3.1 pro', description: 'latest & most capable' },
    { key: 'gemini-3-flash-preview', name: 'gemini 3 flash', description: 'latest & fast' },
    { key: 'gemini-3.1-flash-lite-preview', name: 'gemini 3.1 flash lite', description: 'latest & fastest' },
    { key: 'gemini-2.5-pro', name: 'gemini 2.5 pro', description: 'most capable' },
    { key: 'gemini-2.5-flash', name: 'gemini 2.5 flash', description: 'fast & efficient' },
    { key: 'gemini-2.5-flash-lite', name: 'gemini 2.5 flash lite', description: 'fastest' },
];

export function mapMetadataOptions(options?: MetadataOption[] | null): ModeOption[] {
    if (!options || options.length === 0) {
        return [];
    }

    return options.map((option) => ({
        key: option.code,
        name: option.value,
        description: option.description ?? null,
    }));
}

export function getClaudePermissionModes(translate: Translate): PermissionMode[] {
    return [
        { key: 'default', name: translate('agentInput.permissionMode.default'), description: null },
        { key: 'plan', name: translate('agentInput.permissionMode.plan'), description: null },
        { key: 'dontAsk', name: translate('agentInput.permissionMode.dontAsk'), description: null },
        { key: 'acceptEdits', name: translate('agentInput.permissionMode.acceptEdits'), description: null },
        { key: 'bypassPermissions', name: translate('agentInput.permissionMode.bypassPermissions'), description: null },
    ];
}

export function getCodexPermissionModes(translate: Translate): PermissionMode[] {
    return [
        { key: 'default', name: translate('agentInput.codexPermissionMode.default'), description: null },
        { key: 'read-only', name: translate('agentInput.codexPermissionMode.readOnly'), description: null },
        { key: 'safe-yolo', name: translate('agentInput.codexPermissionMode.safeYolo'), description: null },
        { key: 'yolo', name: translate('agentInput.codexPermissionMode.yolo'), description: null },
    ];
}

export function getGeminiPermissionModes(translate: Translate): PermissionMode[] {
    return [
        { key: 'default', name: translate('agentInput.geminiPermissionMode.default'), description: null },
        { key: 'auto_edit', name: translate('agentInput.geminiPermissionMode.autoEdit'), description: null },
        { key: 'yolo', name: translate('agentInput.geminiPermissionMode.yolo'), description: null },
        { key: 'plan', name: translate('agentInput.geminiPermissionMode.plan'), description: null },
    ];
}

// A model key travels verbatim to the Claude CLI's `--model`, so the two kinds
// of entry below mean different things over the wire: an alias hands the choice
// of model to the CLI, a version id pins one.
//
// [LAW:one-source-of-truth] Which model the CLI resolves `opus` to is a fact the
// CLI owns. An alias label that named a version ('opus 4.7') would be a second
// copy of that fact, free to drift from it — and did, which is the bug this
// list is here to stop repeating. Alias entries therefore name only a tier.
const CLAUDE_MODEL_ALIASES: ModelMode[] = [
    { key: 'default', name: 'default model', description: null },
    { key: 'opus', name: 'opus', description: 'latest opus' },
    { key: 'sonnet', name: 'sonnet', description: 'latest sonnet' },
    { key: 'haiku', name: 'haiku', description: 'latest haiku' },
];

// Pinned entries: the key is an exact Anthropic model id, so the label restates
// the key rather than predicting the CLI. Going stale here means the list is
// incomplete, never that it lies.
const CLAUDE_MODEL_VERSIONS: ModelMode[] = [
    { key: 'claude-fable-5', name: 'fable 5', description: 'most capable' },
    { key: 'claude-opus-5', name: 'opus 5', description: null },
    { key: 'claude-opus-4-8', name: 'opus 4.8', description: null },
    { key: 'claude-opus-4-7', name: 'opus 4.7', description: null },
    { key: 'claude-opus-4-6', name: 'opus 4.6', description: null },
    { key: 'claude-sonnet-5', name: 'sonnet 5', description: null },
    { key: 'claude-sonnet-4-6', name: 'sonnet 4.6', description: null },
    { key: 'claude-haiku-4-5', name: 'haiku 4.5', description: 'fastest' },
];

// Fallback only — `getAvailableModels` prefers the roster the CLI publishes in
// session metadata, and reaches this list for local-mode sessions and CLIs too
// old to publish one.
export function getClaudeModelModes(): ModelMode[] {
    return [...CLAUDE_MODEL_ALIASES, ...CLAUDE_MODEL_VERSIONS];
}

export function getCodexModelModes(): ModelMode[] {
    return [
        { key: 'default', name: 'default model', description: null },
        { key: 'gpt-5.5', name: 'gpt-5.5', description: null },
        { key: 'gpt-5.4', name: 'gpt-5.4', description: null },
        { key: 'gpt-5.3-codex', name: 'gpt-5.3-codex', description: null },
        { key: 'gpt-5.2-codex', name: 'gpt-5.2-codex', description: null },
        { key: 'gpt-5.1-codex-max', name: 'gpt-5.1-codex-max', description: null },
        { key: 'gpt-5.2', name: 'gpt-5.2', description: null },
        { key: 'gpt-5.1-codex-mini', name: 'gpt-5.1-codex-mini', description: null },
    ];
}

export function getGeminiModelModes(): ModelMode[] {
    return GEMINI_MODEL_FALLBACKS;
}

export function getOpenClawPermissionModes(translate: Translate): PermissionMode[] {
    return [
        { key: 'default', name: translate('agentInput.permissionMode.default'), description: null },
        { key: 'bypassPermissions', name: translate('agentInput.permissionMode.bypassPermissions'), description: null },
    ];
}

export function getHardcodedPermissionModes(flavor: AgentFlavor, translate: Translate): PermissionMode[] {
    if (flavor === 'codex') {
        return getCodexPermissionModes(translate);
    }
    if (flavor === 'gemini') {
        return getGeminiPermissionModes(translate);
    }
    if (flavor === 'openclaw') {
        return getOpenClawPermissionModes(translate);
    }
    return getClaudePermissionModes(translate);
}

export function getOpenClawModelModes(): ModelMode[] {
    return [
        { key: 'default', name: 'default model', description: null },
    ];
}

export function getHardcodedModelModes(flavor: AgentFlavor, _translate: Translate): ModelMode[] {
    if (flavor === 'codex') {
        return getCodexModelModes();
    }
    if (flavor === 'gemini') {
        return getGeminiModelModes();
    }
    if (flavor === 'openclaw') {
        return getOpenClawModelModes();
    }
    return getClaudeModelModes();
}

// The roster the Claude CLI publishes is its *picker* list — aliases only
// (default/sonnet/haiku/opus[1m]), each labelled with the version it currently
// resolves to. `--model` still accepts an exact model id that never appears
// there, so a roster used verbatim would take version pinning away from the
// user. Append the pinned entries the roster does not already cover; each one's
// label restates its key, so an entry this CLI rejects fails loudly at the CLI
// rather than quietly running a different model.
function withPinnedClaudeVersions(roster: ModelMode[]): ModelMode[] {
    const rosterKeys = new Set(roster.map((model) => model.key));
    return [...roster, ...CLAUDE_MODEL_VERSIONS.filter((model) => !rosterKeys.has(model.key))];
}

export function getAvailableModels(
    flavor: AgentFlavor,
    metadata: Metadata | null | undefined,
    translate: Translate,
): ModelMode[] {
    const metadataModels = mapMetadataOptions(metadata?.models);
    if (metadataModels.length > 0) {
        if (flavor === 'codex' && !metadataModels.some((model) => model.key === 'default')) {
            return [{ key: 'default', name: 'default model', description: null }, ...metadataModels];
        }
        if (flavor === 'claude') {
            return withPinnedClaudeVersions(metadataModels);
        }
        return metadataModels;
    }
    return getHardcodedModelModes(flavor, translate);
}

export function getAvailablePermissionModes(
    flavor: AgentFlavor,
    metadata: Metadata | null | undefined,
    translate: Translate,
): PermissionMode[] {
    if (flavor === 'claude' || flavor === 'codex' || flavor === 'openclaw') {
        return hackModes(getHardcodedPermissionModes(flavor, translate));
    }

    const metadataModes = mapMetadataOptions(metadata?.operatingModes);
    if (metadataModes.length > 0) {
        return hackModes(metadataModes);
    }

    return hackModes(getHardcodedPermissionModes(flavor, translate));
}

export function findOptionByKey<T extends ModeOption>(options: T[], key: string | null | undefined): T | null {
    if (!key) {
        return null;
    }
    return options.find((option) => option.key === key) ?? null;
}

export function resolveCurrentOption<T extends ModeOption>(
    options: T[],
    preferredKeys: Array<string | null | undefined>,
): T | null {
    for (const key of preferredKeys) {
        const option = findOptionByKey(options, key);
        if (option) {
            return option;
        }
    }
    return null;
}

export function getDefaultModelKey(flavor: AgentFlavor): string {
    if (flavor === 'codex') {
        return 'default';
    }
    if (flavor === 'gemini') {
        return 'gemini-2.5-pro';
    }
    return 'default';
}

export function getDefaultPermissionModeKey(_flavor: AgentFlavor): string {
    return 'default';
}

// Effort levels per agent type

// A ladder owns two independent facts: which levels exist, and which one a
// session starts on. Deriving the second from the first — the rule here used to
// read the last entry — ties the default to list order, so appending a level
// silently re-picks it. They are stated separately because they are separate.
type EffortLadder = {
    readonly levels: readonly EffortLevel[];
    // null means this flavor has no effort ladder at all, which is why the
    // lookups below need no emptiness check: the empty ladder answers for them.
    readonly defaultKey: string | null;
};

// [LAW:types-are-the-program] `defaultKey` is checked against the ladder's own
// keys, so a default that is not a level on the ladder does not compile — and
// appending a level cannot move it. `NoInfer` is what makes that a check rather
// than a wish: without it an unknown key would simply widen `K` to admit itself.
// Effort level names restate their keys, so the builder derives the label rather
// than keeping a second copy of it.
function effortLadder<K extends string>(keys: readonly K[], defaultKey: NoInfer<K>): EffortLadder {
    return { levels: keys.map((key) => ({ key, name: key })), defaultKey };
}

// Ordered shallowest to deepest: xhigh sits between high and max, and is the
// recommendation for coding and agentic work — its absence was pushing users
// past it to max, which costs more and can overthink simpler tasks.
// high stays the start: it is the API default, and the level above it should be
// somewhere the user chooses to go, never somewhere they land.
const CLAUDE_EFFORT_LADDER = effortLadder(['low', 'medium', 'high', 'xhigh', 'max'] as const, 'high');

// xhigh is what Codex sessions already started on under the last-entry rule.
// Only Claude's default is re-decided here; preserving Codex's keeps this an
// explicit statement of the status quo rather than a silent change to it.
const CODEX_EFFORT_LADDER = effortLadder(['low', 'medium', 'high', 'xhigh'] as const, 'xhigh');

const NO_EFFORT_LADDER: EffortLadder = { levels: [], defaultKey: null };

// Claude and Codex expose effort levels regardless of which specific model is
// picked — one ladder per flavor. Callers get a copy so the module's own ladders
// stay immutable.
function getEffortLadder(flavor: AgentFlavor): EffortLadder {
    if (flavor === 'claude') return CLAUDE_EFFORT_LADDER;
    if (flavor === 'codex') return CODEX_EFFORT_LADDER;
    return NO_EFFORT_LADDER;
}

export function getClaudeEffortLevels(): EffortLevel[] {
    return [...CLAUDE_EFFORT_LADDER.levels];
}

export function getCodexEffortLevels(): EffortLevel[] {
    return [...CODEX_EFFORT_LADDER.levels];
}

export function getHardcodedEffortLevels(flavor: AgentFlavor): EffortLevel[] {
    return [...getEffortLadder(flavor).levels];
}

// Per-model effort: returns effort levels for a specific model, or empty if the model has no effort
export function getEffortLevelsForModel(flavor: AgentFlavor, _modelKey: string): EffortLevel[] {
    return [...getEffortLadder(flavor).levels];
}

// The one answer to "what effort does a session start on".
export function getDefaultEffortKeyForModel(flavor: AgentFlavor, _modelKey: string): string | null {
    return getEffortLadder(flavor).defaultKey;
}

export function getSupportsWorktree(flavor: AgentFlavor): boolean {
    if (flavor === 'openclaw') return false;
    return true;
}
