import { UnprocessableEntityException } from '@nestjs/common';
import { sql } from '@vipe/db';
import type { UnitOfWork } from '../db/unit-of-work';
import type { ModifierErrorCode } from './modifiers.dto';

/** One option of a line as private.resolve_line_modifiers returns it (the order_item_modifiers snapshot). */
export interface LineModifier {
  groupId: string;
  groupName: string;
  optionId: string;
  name: string;
  price: number;
}

interface SnapshotRow {
  group_id: string;
  group_name: string;
  option_id: string;
  option_name: string;
  price: number | string;
}

/** `<code>: <Spanish message>`, the 22023 private.resolve_line_modifiers raises. */
const MODIFIER_ERROR = /^(modifier_[a-z]+): (.*)$/s;

/**
 * The options of each line, validated for its dish by
 * private.resolve_line_modifiers (0023) in one query: the same rule
 * create_delivery_order applies. A broken rule is a 422 with its `code`
 * (modifier_invalid, modifier_inactive, modifier_duplicate, modifier_required,
 * modifier_max) and the Spanish message; lines without options still check
 * the required groups of their dish.
 */
export async function resolveLineModifiers(
  uow: UnitOfWork,
  lines: readonly { dishId: string; optionIds: readonly string[] }[],
): Promise<LineModifier[][]> {
  if (lines.length === 0) {
    return [];
  }
  const input = lines.map((line, ord) => ({ ord, dish_id: line.dishId, option_ids: line.optionIds }));
  try {
    const { rows } = await uow.db.execute(sql`
      SELECT x.ord, private.resolve_line_modifiers(x.dish_id, x.option_ids) AS snapshot
        FROM jsonb_to_recordset(${JSON.stringify(input)}::jsonb) AS x(ord integer, dish_id uuid, option_ids uuid[])
       ORDER BY x.ord`);
    return (rows as { snapshot: SnapshotRow[] }[]).map((row) =>
      row.snapshot.map((m) => ({
        groupId: m.group_id,
        groupName: m.group_name,
        optionId: m.option_id,
        name: m.option_name,
        price: Number(m.price),
      })),
    );
  } catch (error) {
    throw modifierError(error) ?? error;
  }
}

/** Whole cents: the unit price of a line is the dish price plus its options, without float drift. */
export function linePrice(dishPrice: number, modifiers: readonly LineModifier[]): number {
  const cents = modifiers.reduce((sum, m) => sum + Math.round(m.price * 100), Math.round(dishPrice * 100));
  return cents / 100;
}

/** The 422 of a modifier rule broken in the database (also create_delivery_order), else undefined. */
export function modifierError(error: unknown): UnprocessableEntityException | undefined {
  for (let current = error, depth = 0; depth < 5 && current instanceof Error; depth++) {
    const { code } = current as { code?: unknown };
    const match = code === '22023' ? MODIFIER_ERROR.exec(current.message) : null;
    if (match) {
      return new UnprocessableEntityException({ message: match[2], code: match[1] as ModifierErrorCode });
    }
    current = current.cause;
  }
  return undefined;
}
