import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { toErrorResponse } from './error-response';

/** Shape of a `pg` DatabaseError, optionally wrapped the way Drizzle wraps it. */
const pgError = (code: string, message = `driver detail ${code}`, detail?: string) =>
  Object.assign(new Error(message), { code, ...(detail === undefined ? {} : { detail }) });
const drizzleWrapped = (cause: Error) => Object.assign(new Error('Failed query: select ...'), { cause });

describe('toErrorResponse', () => {
  it('keeps the status and message of an HttpException', () => {
    expect(toErrorResponse(new UnauthorizedException('Invalid credentials'))).toEqual({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Invalid credentials',
    });
    expect(toErrorResponse(new ForbiddenException('Insufficient role'))).toEqual({
      statusCode: 403,
      error: 'Forbidden',
      message: 'Insufficient role',
    });
  });

  it('keeps the extra fields of an HttpException body object', () => {
    const shortages = [{ ingredientId: 'i1', missing: 50 }];
    expect(toErrorResponse(new ConflictException({ message: 'Insufficient stock', shortages }))).toEqual({
      statusCode: 409,
      error: 'Conflict',
      message: 'Insufficient stock',
      shortages,
    });
  });

  it('joins a list of validation messages', () => {
    expect(toErrorResponse(new BadRequestException(['email: required', 'password: required']))).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: 'email: required; password: required',
    });
  });

  it.each([
    ['23505', 409, 'Conflict', 'Conflict with existing data'],
    ['42501', 403, 'Forbidden', 'Permission denied'],
    ['23514', 422, 'Unprocessable Entity', 'Invalid data'],
    ['23503', 422, 'Unprocessable Entity', 'Invalid data'],
    ['22P02', 422, 'Unprocessable Entity', 'Invalid data'],
    ['22023', 422, 'Unprocessable Entity', 'Invalid data'],
    ['P0002', 404, 'Not Found', 'Not found'],
  ])('maps SQLSTATE %s to %i with its code and without the driver message', (code, statusCode, error, message) => {
    expect(toErrorResponse(pgError(code))).toEqual({ statusCode, error, message, code });
    expect(toErrorResponse(drizzleWrapped(pgError(code)))).toEqual({ statusCode, error, message, code });
  });

  it('keeps the message of a 22023 raised by a plpgsql RAISE (the inventory UI matches it)', () => {
    const raised = Object.assign(pgError('22023', 'save_formula: ingredient x appears twice'), { routine: 'exec_stmt_raise' });
    const expected = { statusCode: 422, error: 'Unprocessable Entity', message: 'save_formula: ingredient x appears twice', code: '22023' };
    expect(toErrorResponse(raised)).toEqual(expected);
    expect(toErrorResponse(drizzleWrapped(raised))).toEqual(expected);
    // A 22023 from a built-in function keeps the generic message.
    const builtin = Object.assign(pgError('22023', 'invalid value for parameter'), { routine: 'parse_int' });
    expect(toErrorResponse(builtin).message).toBe('Invalid data');
  });

  it('never returns the driver DETAIL outside P0001', () => {
    expect(toErrorResponse(pgError('23505', 'dup', 'Key (email)=(a@b.c) already exists.'))).toEqual({
      statusCode: 409,
      error: 'Conflict',
      message: 'Conflict with existing data',
      code: '23505',
    });
  });

  it('maps P0001 (RAISE EXCEPTION) to 422 with the raised message verbatim and code P0001', () => {
    const raised = pgError('P0001', 'Register is closed');
    expect(toErrorResponse(raised)).toEqual({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: 'Register is closed',
      code: 'P0001',
    });
    expect(toErrorResponse(drizzleWrapped(raised))).toEqual(toErrorResponse(raised));
  });

  it('adds the RAISE DETAIL of a P0001 as details', () => {
    const shortages = '[{"ingredient_id": "i1", "missing": 2}]';
    expect(toErrorResponse(drizzleWrapped(pgError('P0001', 'Insufficient stock', shortages)))).toEqual({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: 'Insufficient stock',
      code: 'P0001',
      details: shortages,
    });
  });

  it('answers 500 for unknown errors and unknown SQLSTATEs without leaking details', () => {
    const body = { statusCode: 500, error: 'Internal Server Error', message: 'Internal server error' };
    expect(toErrorResponse(new Error('secret connection string'))).toEqual(body);
    expect(toErrorResponse(pgError('08006'))).toEqual(body);
    expect(toErrorResponse('a string')).toEqual(body);
  });
});
