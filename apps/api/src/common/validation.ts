import { UnprocessableEntityException } from '@nestjs/common';
import { z } from 'zod';

/**
 * Parse a request body or query with a zod schema; invalid input (including
 * unknown fields, rejected by `.strict()` schemas) is a 422 listing each issue.
 */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const parsed = schema.safeParse(input ?? {});
  if (!parsed.success) {
    throw new UnprocessableEntityException(
      parsed.error.issues.map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message)),
    );
  }
  return parsed.data;
}

/** Route id parameter. `z.guid()` accepts any 8-4-4-4-12 hex id, like the uuid column does. */
export const idParamSchema = z.guid();

/** `?active=true|false`; omitted means no filter. */
export const booleanQuery = z.enum(['true', 'false']).transform((value) => value === 'true');

/** `a,b,c` query value split on commas, blanks dropped (an empty value is an empty list). */
const csv = z.string().transform((value) => value.split(',').map((part) => part.trim()).filter(Boolean));

/** `a,b,c` query value, each part one of `values`, at least one. */
export const csvOf = <T extends string>(values: readonly [T, ...T[]]) => csv.pipe(z.array(z.enum(values)).min(1));

/** `id1,id2` query value of uuids; `?ids=` is an empty list. */
export const guidListQuery = (max: number) => csv.pipe(z.array(z.guid()).max(max));

/** `?date=YYYY-MM-DD`, a real calendar day. */
export const dateQuery = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, 'Invalid date');

/** A timestamptz column read in Drizzle string mode (`2026-01-01 00:00:00+00`) as ISO 8601. */
export function toIso(value: string): string;
export function toIso(value: string | null): string | null;
export function toIso(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  return new Date(value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')).toISOString();
}
