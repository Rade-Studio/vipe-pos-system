import { describe, expect, it } from 'vitest';
import { normalizeColombianPhone, normalizePhone } from './phone';

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

/** H-074, H-038: cases of lib/delivery/phone.test.ts normalizeColombianPhone. */
describe('normalizeColombianPhone', () => {
  it.each([
    ['3101234567', '3101234567'],
    ['+57 310 123 4567', '3101234567'],
    ['6011234567', '6011234567'],
    ['+57 604 123 4567', '6041234567'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeColombianPhone(input)).toBe(expected);
  });

  it.each(['', 'abc', '1234567', '2101234567', '6111234567', '31012345678', '123456789012345'])('%j -> null', (input) => {
    expect(normalizeColombianPhone(input)).toBeNull();
  });
});
