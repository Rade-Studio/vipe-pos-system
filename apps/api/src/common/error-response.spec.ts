import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { toErrorResponse } from './error-response';

/** Shape of a `pg` DatabaseError, optionally wrapped the way Drizzle wraps it. */
const pgError = (code: string, message = `driver detail ${code}`) => Object.assign(new Error(message), { code });
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
  ])('maps SQLSTATE %s to %i without the driver message', (code, statusCode, error, message) => {
    expect(toErrorResponse(pgError(code))).toEqual({ statusCode, error, message });
    expect(toErrorResponse(drizzleWrapped(pgError(code)))).toEqual({ statusCode, error, message });
  });

  it('maps P0001 (RAISE EXCEPTION) to 422 with the raised message verbatim', () => {
    const raised = pgError('P0001', 'Register is closed');
    expect(toErrorResponse(raised)).toEqual({ statusCode: 422, error: 'Unprocessable Entity', message: 'Register is closed' });
    expect(toErrorResponse(drizzleWrapped(raised)).message).toBe('Register is closed');
  });

  it('answers 500 for unknown errors and unknown SQLSTATEs without leaking details', () => {
    const body = { statusCode: 500, error: 'Internal Server Error', message: 'Internal server error' };
    expect(toErrorResponse(new Error('secret connection string'))).toEqual(body);
    expect(toErrorResponse(pgError('08006'))).toEqual(body);
    expect(toErrorResponse('a string')).toEqual(body);
  });
});
