import { STATUS_CODES } from 'node:http';
import { HttpException } from '@nestjs/common';

export interface ErrorResponse {
  statusCode: number;
  error: string;
  message: string;
  /** Extra fields an HttpException body carries, e.g. 409 `{shortages}` from POST /orders. */
  [detail: string]: unknown;
}

/**
 * SQLSTATEs the API answers with a client error. The driver message is never
 * returned (it can name tables, constraints or values), except for P0001: the
 * plpgsql RPCs RAISE EXCEPTION with messages written for the caller.
 */
const SQLSTATE_RESPONSES: Record<string, { statusCode: number; message: string }> = {
  '23505': { statusCode: 409, message: 'Conflict with existing data' },
  '42501': { statusCode: 403, message: 'Permission denied' },
  '23514': { statusCode: 422, message: 'Invalid data' },
  '23503': { statusCode: 422, message: 'Invalid data' },
  '22P02': { statusCode: 422, message: 'Invalid data' },
  // Raised by the RPCs for bad input (22023) and rows missing or in another tenant (P0002).
  '22023': { statusCode: 422, message: 'Invalid data' },
  P0002: { statusCode: 404, message: 'Not found' },
};

const body = (statusCode: number, message: string): ErrorResponse => ({
  statusCode,
  error: STATUS_CODES[statusCode] ?? 'Error',
  message,
});

/** Map anything thrown by a handler to the API's single error shape. */
export function toErrorResponse(exception: unknown): ErrorResponse {
  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    const message = typeof response === 'string' ? response : (response as { message?: unknown }).message;
    if (Array.isArray(message)) {
      return body(exception.getStatus(), message.join('; '));
    }
    return {
      ...details(response),
      ...body(exception.getStatus(), typeof message === 'string' ? message : exception.message),
    };
  }

  const pg = findPostgresError(exception);
  if (pg?.code === 'P0001') {
    return body(422, pg.message);
  }
  const mapped = pg ? SQLSTATE_RESPONSES[pg.code] : undefined;
  if (mapped) {
    return body(mapped.statusCode, mapped.message);
  }
  return body(500, 'Internal server error');
}

/** Fields of an HttpException body object besides the standard three. */
function details(response: string | object): Record<string, unknown> {
  if (typeof response === 'string') {
    return {};
  }
  const { statusCode: _statusCode, error: _error, message: _message, ...rest } = response as Record<string, unknown>;
  return rest;
}

/** The `pg` error behind an exception; Drizzle wraps it as `cause`. */
function findPostgresError(exception: unknown): { code: string; message: string } | undefined {
  let current: unknown = exception;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
      return { code, message: current.message };
    }
    current = current.cause;
  }
  return undefined;
}
