import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { cartaDbError } from './carta-errors';

const pgError = (message: string, code = 'P0001') => Object.assign(new Error(message), { code });
const thrown = (error: unknown) => {
  try {
    cartaDbError(error);
  } catch (caught) {
    return caught;
  }
  throw new Error('cartaDbError did not throw');
};

describe('cartaDbError', () => {
  it('maps a known 0035 code to its Spanish answer', () => {
    const error = thrown(pgError('guest_submit_proposal: table_not_open')) as HttpException;
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(409);
    expect(error.message).toBe('Para pedir desde aquí, la mesa debe estar abierta');
  });

  it('never forwards the raw message of an unmapped carta code', () => {
    const error = thrown(pgError('guest_submit_proposal: brand_new_code')) as HttpException;
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(422);
    expect(error.message).toBe('No pudimos procesar la solicitud.');
    expect(JSON.stringify(error.getResponse())).not.toContain('brand_new_code');
  });

  it('finds the code through a cause chain', () => {
    const wrapped = Object.assign(new Error('Failed query'), { cause: pgError('guest_request: kind_invalid', '22023') });
    expect((thrown(wrapped) as HttpException).getStatus()).toBe(422);
  });

  it('leaves errors that are not carta function errors unchanged (the waiter path keeps its own answers)', () => {
    const waiterPath = new HttpException('Insufficient stock', 409);
    expect(thrown(waiterPath)).toBe(waiterPath);
    const plain = pgError('duplicate key value violates unique constraint', '23505');
    expect(thrown(plain)).toBe(plain);
  });
});
