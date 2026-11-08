import { describe, expect, it } from 'vitest';
import { printLines } from './print-lines';

describe('printLines (F7 T4)', () => {
  it("renames a cart line's groupName to the print payload's group, keeping name and price only", () => {
    const line = {
      name: 'Hamburguesa',
      quantity: 1,
      modifiers: [{ groupId: 'g', groupName: 'Adiciones', optionId: 'o', name: 'Queso cheddar', price: 3000 }],
    };
    expect(printLines([line])).toEqual([
      { name: 'Hamburguesa', quantity: 1, modifiers: [{ group: 'Adiciones', name: 'Queso cheddar', price: 3000 }] },
    ]);
  });

  it('keeps a line already in the print shape, and a line without options, exactly as sent', () => {
    const server = { name: 'Pizza', quantity: 1, modifiers: [{ group: 'Sin', name: 'Sin cebolla', price: 0 }] };
    const plain = { name: 'Jugo', quantity: 2, comments: 'sin hielo' };
    const empty = { name: 'Arepa', quantity: 1, modifiers: [] };
    const [a, b, c] = printLines([server, plain, empty]);
    expect(a).toEqual(server);
    expect(b).toBe(plain);
    expect(c).toBe(empty);
  });

  it('leaves malformed modifiers for the printer to skip', () => {
    const odd = { name: 'X', quantity: 1, modifiers: 'x' };
    expect(printLines([odd])[0]).toBe(odd);
  });
});
