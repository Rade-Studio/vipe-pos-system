import { ConflictException } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import type { UnitOfWork } from '../db/unit-of-work';

/**
 * H-022: the comparison key of a name, so "Bebidas", " BEBÍDAS " and
 * "bebidas" collide: accents dropped, lower case, inner spaces collapsed.
 */
export function nameKey(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The tables whose names are unique per restaurant in the API (no unique index: older rows may repeat). */
const NAMED_TABLES = {
  categories: { from: sql`public.categories`, message: (name: string) => `Ya existe una categoría llamada "${name}"` },
  dishes: { from: sql`public.dishes`, message: (name: string) => `Ya existe un plato llamado "${name}"` },
  ingredients: { from: sql`public.ingredients`, message: (name: string) => `Ya existe un artículo llamado "${name}"` },
} satisfies Record<string, { from: SQL; message: (name: string) => string }>;

export type NamedTable = keyof typeof NAMED_TABLES;

/**
 * 409 with a Spanish message when another row of `table` (RLS: the caller's
 * restaurant, active or not) has the same `nameKey`; `exceptId` is the row
 * being renamed (its unchanged name is never refused). A check, not a constraint: two concurrent requests may both pass.
 */
export async function assertUniqueName(uow: UnitOfWork, table: NamedTable, name: string | undefined, exceptId: string | null = null): Promise<void> {
  if (name === undefined) return;
  const spec = NAMED_TABLES[table];
  const key = nameKey(name);
  const { rows } = await uow.db.execute(sql`SELECT id, name FROM ${spec.from} ORDER BY name, id`);
  const named = rows as { id: string; name: string }[];
  // An unchanged name (same key) saves even when older rows already repeat it: the forms resend it.
  const current = exceptId === null ? undefined : named.find((row) => row.id === exceptId);
  if (current && nameKey(current.name) === key) return;
  const same = named.find((row) => row.id !== exceptId && nameKey(row.name) === key);
  if (same) throw new ConflictException(spec.message(same.name));
}
