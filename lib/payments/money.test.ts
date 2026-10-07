import { describe, expect, it } from 'vitest';
import { assertWholePesos } from './money';

describe('assertWholePesos', () => {
  it('returns the amount when it is a non-negative integer', () => {
    expect(assertWholePesos(0)).toBe(0);
    expect(assertWholePesos(1)).toBe(1);
    expect(assertWholePesos(125000)).toBe(125000);
  });

  it('rejects decimal amounts', () => {
    expect(() => assertWholePesos(1500.5)).toThrow(RangeError);
    expect(() => assertWholePesos(0.5)).toThrow(RangeError);
  });

  it('rejects negative amounts', () => {
    expect(() => assertWholePesos(-1)).toThrow(RangeError);
  });

  it('rejects NaN and Infinity', () => {
    expect(() => assertWholePesos(Number.NaN)).toThrow(RangeError);
    expect(() => assertWholePesos(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => assertWholePesos(Number.NEGATIVE_INFINITY)).toThrow(RangeError);
  });
});