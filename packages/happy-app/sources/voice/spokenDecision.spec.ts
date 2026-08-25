import { describe, it, expect } from 'vitest';
import { classifySpokenDecision } from './spokenDecision';

// These cases are the shape table at the top of spokenDecision.ts, transcribed. When a new phrase
// needs handling, it becomes a row there and a row here — never a special case in the body.

describe('classifySpokenDecision', () => {
    describe('accepts as allow', () => {
        const cases = [
            'yes', 'Yes.', '  YES  ', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay',
            'allow', 'approve', 'affirmative', 'proceed', 'confirm',
            'go ahead', 'do it', 'yes please', 'sounds good',
        ];
        it.each(cases)('%j -> allow', (input) => {
            expect(classifySpokenDecision(input)).toBe('allow');
        });
    });

    describe('accepts as deny', () => {
        const cases = [
            'no', 'No.', 'nope', 'nah', 'deny', 'reject', 'negative',
            'cancel', 'stop', "don't", 'skip', 'abort', 'do not', 'no way',
        ];
        it.each(cases)('%j -> deny', (input) => {
            expect(classifySpokenDecision(input)).toBe('deny');
        });
    });

    describe('rejects to unclear', () => {
        it('treats silence and whitespace as no answer', () => {
            expect(classifySpokenDecision('')).toBe('unclear');
            expect(classifySpokenDecision('   ')).toBe('unclear');
            expect(classifySpokenDecision('...')).toBe('unclear');
        });

        it('does not hear a decision in filler', () => {
            expect(classifySpokenDecision('uh')).toBe('unclear');
            expect(classifySpokenDecision('hmm')).toBe('unclear');
        });

        // The enumeration gap this classifier exists to close: every one of these CONTAINS a
        // decision token as a substring while containing no decision.
        // Note "yes-man" is deliberately absent: a hyphen is a word separator, so it normalizes to
        // "yes man" and reading it as a yes is correct — transcribers emit "go-ahead" for "go ahead".
        it.each(['yesterday', 'eyes', 'yeshiva'])('%j contains "yes" but is not a yes', (input) => {
            expect(classifySpokenDecision(input)).not.toBe('allow');
        });

        it.each(['notice', 'another', 'nothing', 'november'])('%j contains "no" but is not a no', (input) => {
            expect(classifySpokenDecision(input)).not.toBe('deny');
        });

        it('refuses to pick a side when both are present', () => {
            expect(classifySpokenDecision('yes and no')).toBe('unclear');
            expect(classifySpokenDecision('no, wait, yes')).toBe('unclear');
        });

        // Each of these carries a deny token while meaning uncertainty. Reading them as 'deny'
        // would deny an action the user never decided about.
        it.each(["I don't know", 'not sure', 'no idea', 'can you repeat that'])(
            '%j expresses uncertainty, not denial',
            (input) => {
                expect(classifySpokenDecision(input)).toBe('unclear');
            },
        );
    });

    describe('the property that matters most', () => {
        it('never turns an unrecognized transcript into a decision', () => {
            // Anything we cannot read must land on 'unclear'. A wrong 'deny' silently discards the
            // agent's work; a wrong 'allow' runs something unsanctioned. Both are worse than asking
            // again, so the fallback is neither.
            const gibberish = [
                'the quick brown fox', 'call mom later', '42', 'π', 'こんにちは',
                'please summarize the file', 'wait',
            ];
            for (const input of gibberish) {
                expect(classifySpokenDecision(input)).toBe('unclear');
            }
        });

        it('reads an answer the same however the transcriber punctuates it', () => {
            for (const variant of ['yes', 'Yes', 'YES!', ' yes. ', 'Yes,']) {
                expect(classifySpokenDecision(variant)).toBe('allow');
            }
        });
    });
});
