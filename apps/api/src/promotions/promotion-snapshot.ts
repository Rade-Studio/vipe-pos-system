import { z } from 'zod';
import type { EnginePromotion } from './engine';

/**
 * order_items.promotion_snapshot (S3): the full engine rule of the promotion a
 * line qualified for when it was sent. Later edits, pauses or deletes of the
 * promotion never change a sent line, so its discounts are recomputed from this.
 */

const ids = z.array(z.string());

const snapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['product_discount', 'buy_x_pay_y', 'combo', 'bill_discount']),
  mode: z.enum(['automatic', 'manual', 'manual_pin']),
  active: z.boolean(),
  startDate: z.string(),
  endDate: z.string().nullable(),
  daysOfWeek: z.array(z.number().int()),
  timeWindows: z.array(z.object({ from: z.string(), to: z.string() })),
  channels: z.array(z.string()),
  maxUsesPerOrder: z.number().int().nullable(),
  createdAt: z.string(),
  discountType: z.enum(['percentage', 'fixed_amount']).nullable(),
  discountValue: z.number().nullable(),
  buyQuantity: z.number().int(),
  payQuantity: z.number().int(),
  restDiscountPercent: z.number(),
  comboPrice: z.number(),
  comboGroups: z.array(z.object({ id: z.string(), name: z.string(), dishIds: ids })),
  minSubtotal: z.number().nullable(),
  maxDiscount: z.number().nullable(),
  targets: z.object({ dishIds: ids, categoryIds: ids, subcategoryIds: ids }),
  unitNoun: z.object({ one: z.string(), other: z.string() }).nullable().optional(),
});

/** The stored JSON: exactly the engine fields (zod drops anything else). */
export function toSnapshot<C extends string>(promotion: EnginePromotion<C>): Record<string, unknown> {
  return snapshotSchema.parse({ ...promotion, unitNoun: promotion.unitNoun ?? null });
}

/** The rule back, or null for a line without (or with an unreadable) snapshot. */
export function fromSnapshot<C extends string = string>(value: unknown): EnginePromotion<C> | null {
  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success) return null;
  return { ...parsed.data, unitNoun: parsed.data.unitNoun ?? null } as EnginePromotion<C>;
}
