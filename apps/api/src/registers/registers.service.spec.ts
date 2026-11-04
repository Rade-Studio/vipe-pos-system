import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { UnitOfWork } from '../db/unit-of-work';
import { RegistersService } from './registers.service';

describe('RegistersService.open', () => {
  it('answers 409 when the unique index catches a concurrent open after the pre-check', async () => {
    const raced = Object.assign(new Error('duplicate key value'), { code: '23505', constraint: 'one_open_register_per_restaurant' });
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(Object.assign(new Error('Failed query: insert ...'), { cause: raced }));
    const service = new RegistersService({ db: { execute } } as unknown as UnitOfWork);
    const opened = service.open(1000);
    await expect(opened).rejects.toBeInstanceOf(ConflictException);
    await expect(opened).rejects.toThrow('A register is already open');
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('rethrows other unique violations', async () => {
    const other = Object.assign(new Error('dup'), { code: '23505', constraint: 'cash_registers_pkey' });
    const execute = vi.fn().mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(other);
    const service = new RegistersService({ db: { execute } } as unknown as UnitOfWork);
    await expect(service.open(0)).rejects.toBe(other);
  });
});
