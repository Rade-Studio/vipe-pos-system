import { NotFoundException } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import type { UnitOfWork } from '../db/unit-of-work';

type Json = Record<string, unknown>;

/** Rows of a query in the request transaction. */
export async function rows<T = Json>(uow: UnitOfWork, query: SQL): Promise<T[]> {
  return (await uow.db.execute(query)).rows as T[];
}

/** The single jsonb `result` of `SELECT public.<rpc>(...) AS result`. */
export async function rpc(uow: UnitOfWork, query: SQL): Promise<Json> {
  const [row] = await rows<{ result: Json }>(uow, query);
  return row.result;
}

/** The first row's `column`, or 404 with `message` (missing or another tenant's row, hidden by RLS). */
export async function one<T = Json>(uow: UnitOfWork, query: SQL, column: string, message: string): Promise<T> {
  const [row] = await rows<Json>(uow, query);
  if (!row) {
    throw new NotFoundException(message);
  }
  return row[column] as T;
}

/**
 * Column/value pairs of a write, keeping only the defined values (undefined =
 * not sent, null = clear), the way the web services built their patches.
 */
export function definedColumns(values: Record<string, unknown>): [string, unknown][] {
  return Object.entries(values).filter(([, value]) => value !== undefined);
}

export const setList = (pairs: [string, unknown][]) =>
  sql.join(
    pairs.map(([column, value]) => sql`${sql.identifier(column)} = ${value}`),
    sql`, `,
  );

export const insertColumns = (pairs: [string, unknown][]) =>
  sql`(${sql.join(
    pairs.map(([column]) => sql.identifier(column)),
    sql`, `,
  )}) VALUES (${sql.join(
    pairs.map(([, value]) => sql`${value}`),
    sql`, `,
  )})`;

/** `text` trimmed, `null` kept, `undefined` not sent. */
export const trimmed = (value: string | null | undefined) => (typeof value === 'string' ? value.trim() : value);
