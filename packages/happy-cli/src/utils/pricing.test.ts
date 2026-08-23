import { describe, expect, it } from 'vitest';
import { calculateCost, resolveModelRates } from './pricing';
import type { Usage } from '../api/types';

const MILLION = 1_000_000;

function usage(overrides: Partial<Usage> = {}): Usage {
    return { input_tokens: 0, output_tokens: 0, ...overrides } as Usage;
}

describe('resolveModelRates', () => {
    it('prices each published tier at its rate card', () => {
        expect(resolveModelRates('claude-fable-5')).toEqual({ input: 10, output: 50 });
        expect(resolveModelRates('claude-opus-5')).toEqual({ input: 5, output: 25 });
        expect(resolveModelRates('claude-opus-4-1')).toEqual({ input: 15, output: 75 });
        expect(resolveModelRates('claude-sonnet-5')).toEqual({ input: 2, output: 10 });
        expect(resolveModelRates('claude-sonnet-4-6')).toEqual({ input: 3, output: 15 });
        expect(resolveModelRates('claude-haiku-4-5')).toEqual({ input: 1, output: 5 });
    });

    it('prices a dated snapshot as the model it is a snapshot of', () => {
        expect(resolveModelRates('claude-haiku-4-5-20251001')).toEqual(resolveModelRates('claude-haiku-4-5'));
        expect(resolveModelRates('claude-opus-4-20250514')).toEqual(resolveModelRates('claude-opus-4-0'));
    });

    it('reports unknown rather than substituting a tier', () => {
        expect(resolveModelRates('<synthetic>')).toBeNull();
        expect(resolveModelRates('claude-opus-9')).toBeNull();
        expect(resolveModelRates('opus')).toBeNull();
        expect(resolveModelRates(undefined)).toBeNull();
    });
});

describe('calculateCost', () => {
    it('charges input and output at the model rate', () => {
        const cost = calculateCost(usage({ input_tokens: MILLION, output_tokens: MILLION }), 'claude-opus-5');

        expect(cost).toEqual({ input: 5, output: 25, total: 30 });
    });

    it('does not overstate Opus 5, which once priced as a 15/75 model', () => {
        const opus5 = calculateCost(usage({ input_tokens: MILLION, output_tokens: MILLION }), 'claude-opus-5');
        const legacyOpus = calculateCost(usage({ input_tokens: MILLION, output_tokens: MILLION }), 'claude-opus-4-1');

        expect(opus5!.total).toBeLessThan(legacyOpus!.total);
    });

    it('charges 1-hour cache writes at twice the base input rate, 5-minute at 1.25x', () => {
        const oneHour = calculateCost(
            usage({ cache_creation: { ephemeral_1h_input_tokens: MILLION } }),
            'claude-opus-5'
        );
        const fiveMinute = calculateCost(
            usage({ cache_creation: { ephemeral_5m_input_tokens: MILLION } }),
            'claude-opus-5'
        );

        expect(oneHour!.input).toBeCloseTo(10, 10);
        expect(fiveMinute!.input).toBeCloseTo(6.25, 10);
    });

    it('charges cache reads at a tenth of the base input rate', () => {
        const cost = calculateCost(usage({ cache_read_input_tokens: MILLION }), 'claude-opus-5');

        expect(cost!.input).toBeCloseTo(0.5, 10);
    });

    it('prices an undifferentiated cache-write total as a 5-minute write', () => {
        const cost = calculateCost(usage({ cache_creation_input_tokens: MILLION }), 'claude-opus-5');

        expect(cost!.input).toBeCloseTo(6.25, 10);
    });

    it('returns no cost when the serving model has no published rate', () => {
        expect(calculateCost(usage({ input_tokens: MILLION }), '<synthetic>')).toBeNull();
        expect(calculateCost(usage({ input_tokens: MILLION }))).toBeNull();
    });
});
