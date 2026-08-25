// Turning a speech transcript into a permission decision.
//
// SHAPE TABLE — written before the body, and mirrored verbatim in spokenDecision.spec.ts.
//
// MUST ACCEPT as 'allow':  yes | Yes. | "  YES  " | yeah | yep | yup | sure | ok | okay |
//                          allow | approve | affirmative | proceed | confirm |
//                          "go ahead" | "do it" | "yes please" | "sounds good"
// MUST ACCEPT as 'deny':   no | No. | nope | nah | deny | reject | negative | cancel | stop |
//                          don't | skip | abort | "do not" | "no way"
// MUST REJECT to 'unclear':
//   ""                  — silence; the recorder heard nothing
//   "   "               — whitespace only
//   "uh" / "hmm"        — sound, no decision
//   "yesterday"         — CONTAINS "yes" but is not a yes
//   "notice" "another"  — CONTAIN "no" but are not a no
//   "nothing" "know"    — same trap
//   "yes and no"        — both sides present; the speaker did not decide
//   "I don't know"      — carries a deny token but expresses uncertainty
//   "not sure"          — same
//   "no idea"           — same
//   "can you repeat that" — a request, not an answer
//
// Four invariants fall out of that table, and each one is a line in the body below:
//   (a) matching is word-level, never substring — this is what rejects yesterday/notice/nothing
//   (b) allow and deny both present  -> unclear
//   (c) explicit uncertainty wins over any token it contains -> unclear
//   (d) no recognizable token at all -> unclear
//
// [LAW:types-are-the-program] The return is a three-value enum, not a boolean. 'unclear' is a real
// outcome of listening, not a failure of it, and it is the reason this is not `isAllowed(): boolean`.
// A boolean would force every unclear transcript to become either allow or deny, and whichever one
// it became would be a decision the user never made.
//
// [LAW:no-silent-failure] 'unclear' must never collapse into 'deny'. Denying on a misheard answer is
// an answer-shaped void: it has the exact shape of a real decision while meaning "I could not tell",
// and it silently destroys work the user may well have wanted. The caller has to handle it.

export type SpokenDecision = 'allow' | 'deny' | 'unclear';

// Uncertainty is checked first and wins, because these phrases contain deny tokens ("don't", "no")
// while meaning the opposite of a decision. Matched against the normalized string, so apostrophes
// are already gone: "I don't know" has become "i dont know".
const UNCERTAIN_PHRASES = [
    'dont know',
    'do not know',
    'not sure',
    'no idea',
    'repeat that',
    'say again',
    'what was that',
];

// Multi-word answers, checked before single words so "do not" cannot be read as an unknown "do"
// plus a stray "not".
const ALLOW_PHRASES = ['go ahead', 'do it', 'sounds good', 'yes please', 'go for it'];
const DENY_PHRASES = ['do not', 'no way', 'dont do', 'hold off'];

const ALLOW_WORDS = new Set([
    'yes', 'yeah', 'yep', 'yup', 'ya', 'yah',
    'sure', 'ok', 'okay', 'alright',
    'allow', 'allowed', 'approve', 'approved',
    'affirmative', 'confirm', 'confirmed', 'proceed', 'continue', 'accept',
]);

const DENY_WORDS = new Set([
    'no', 'nope', 'nah', 'negative',
    'deny', 'denied', 'reject', 'rejected',
    'cancel', 'stop', 'dont', 'skip', 'abort', 'never',
]);

/**
 * Lowercase, drop apostrophes so "don't" becomes "dont", and reduce every other non-alphanumeric
 * character to a space. Punctuation and casing carry no decision, and a transcriber may add or omit
 * either freely — normalizing here is what lets the tables above stay small and literal.
 */
function normalize(transcript: string): string {
    return transcript
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

export function classifySpokenDecision(transcript: string): SpokenDecision {
    const normalized = normalize(transcript);

    // (d) Silence, and anything that normalized away to nothing.
    if (normalized.length === 0) {
        return 'unclear';
    }

    // (c) Uncertainty outranks the deny tokens it contains.
    if (UNCERTAIN_PHRASES.some((phrase) => normalized.includes(phrase))) {
        return 'unclear';
    }

    // (a) Word-level membership. Substring matching here is precisely the enumeration gap this
    // classifier exists to avoid: "yesterday" contains "yes" and "notice" contains "no".
    const words = normalized.split(' ');
    const allow = ALLOW_PHRASES.some((p) => normalized.includes(p)) || words.some((w) => ALLOW_WORDS.has(w));
    const deny = DENY_PHRASES.some((p) => normalized.includes(p)) || words.some((w) => DENY_WORDS.has(w));

    // (b) Both sides, or neither, means the speaker did not give an answer we may act on.
    // [LAW:dataflow-not-control-flow] One total mapping over the (allow, deny) pair rather than a
    // chain of early returns — every combination has a named result, including the two that mean
    // "no decision".
    if (allow === deny) {
        return 'unclear';
    }
    return allow ? 'allow' : 'deny';
}
