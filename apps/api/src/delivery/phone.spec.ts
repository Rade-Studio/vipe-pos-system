import { describe, expect, it } from 'vitest';
import { normalizePhone } from './phone';

/** Cases of lib/delivery/phone.test.ts: the server applies the same rule. */
describe('normalizePhone', () => {
  it.each([
    ['+57 310 123 4567', '3101234567'],
    ['573101234567', '3101234567'],
    ['(310) 123-4567', '3101234567'],
    ['571234567', '571234567'],
    ['572101234567', '572101234567'],
    ['1234567', '1234567'],
    ['123456789012345', '123456789012345'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['', 'abc', '12345', '123456', '1234567890123456'])('%j -> null', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});
