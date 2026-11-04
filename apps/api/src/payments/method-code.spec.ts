import { describe, expect, it } from 'vitest';
import { slugifyMethodCode } from './method-code';

/** Cases ported from lib/payments/catalog-admin.test.ts (slugifyMethodCode). */
describe('slugifyMethodCode', () => {
  it('lowercases a simple name', () => {
    expect(slugifyMethodCode('Efectivo', [])).toBe('efectivo');
  });

  it('strips accents and replaces non [a-z0-9] with _', () => {
    expect(slugifyMethodCode('Tarjeta Débito', [])).toBe('tarjeta_debito');
  });

  it('collapses and trims runs of _', () => {
    expect(slugifyMethodCode('100% Bonos!!', [])).toBe('100_bonos');
  });

  it('pads all-non-alphanum names to length 2 with the m_ pattern', () => {
    expect(slugifyMethodCode('   ', [])).toBe('m_');
    expect(slugifyMethodCode('$$$', [])).toBe('m_');
  });

  it('pads single-char results to length 2', () => {
    expect(slugifyMethodCode('A', [])).toBe('a_');
  });

  it('clamps to 32 chars when the base is longer', () => {
    expect(slugifyMethodCode('abcdefghijklmnopqrstuvwxyz12345678', [])).toBe('abcdefghijklmnopqrstuvwxyz123456');
  });

  it('suffixes _2 on collision, then _3', () => {
    expect(slugifyMethodCode('Efectivo', ['efectivo'])).toBe('efectivo_2');
    expect(slugifyMethodCode('Efectivo', ['efectivo', 'efectivo_2'])).toBe('efectivo_3');
  });

  it('trims the base to keep the _N suffix within 32 chars', () => {
    const code = slugifyMethodCode('abcdefghijklmnopqrstuvwxyz12345678', ['abcdefghijklmnopqrstuvwxyz123456']);
    expect(code).toBe('abcdefghijklmnopqrstuvwxyz1234_2');
    expect(code).toHaveLength(32);
  });

  it('returns the base unchanged when the existing list is empty', () => {
    expect(slugifyMethodCode('Nequi', [])).toBe('nequi');
  });
});
