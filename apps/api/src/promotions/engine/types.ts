/**
 * Pure pricing engine types (promociones T2). No framework, no DB, no clock:
 * the caller converts "now" to the restaurant timezone and passes it in.
 * `C` is the order channel type so the API can pass the orders table values.
 */

export type PromotionKind = 'product_discount' | 'buy_x_pay_y' | 'combo' | 'bill_discount';
export type PromotionMode = 'automatic' | 'manual' | 'manual_pin';
export type DiscountType = 'percentage' | 'fixed_amount';

export interface TimeWindow {
  /** 'HH:MM', inclusive. */
  from: string;
  /** 'HH:MM', exclusive ('24:00' allowed). */
  to: string;
}

export interface ComboGroup {
  id: string;
  name: string;
  dishIds: string[];
}

export interface PromotionTargets {
  dishIds: string[];
  categoryIds: string[];
  subcategoryIds: string[];
}

/** Optional noun for hints, e.g. { one: 'cóctel', other: 'cócteles' }. */
export interface UnitNoun {
  one: string;
  other: string;
}

export interface EnginePromotion<C extends string = string> {
  id: string;
  name: string;
  kind: PromotionKind;
  mode: PromotionMode;
  active: boolean;
  /** 'YYYY-MM-DD' in the restaurant timezone. */
  startDate: string;
  endDate: string | null;
  /** ISO 1 = Monday … 7 = Sunday; empty = every day. */
  daysOfWeek: number[];
  /** Empty = all day. */
  timeWindows: TimeWindow[];
  /** Empty = all channels. */
  channels: C[];
  maxUsesPerOrder: number | null;
  /** Any sortable timestamp (ISO string); used for "oldest wins" ties. */
  createdAt: string;
  discountType: DiscountType | null;
  discountValue: number | null;
  buyQuantity: number;
  payQuantity: number;
  restDiscountPercent: number;
  comboPrice: number;
  comboGroups: ComboGroup[];
  minSubtotal: number | null;
  maxDiscount: number | null;
  targets: PromotionTargets;
  unitNoun?: UnitNoun | null;
}

export interface EngineItem {
  id: string;
  dishId: string;
  categoryId: string | null;
  subcategoryId: string | null;
  /** List price incl. options, whole pesos. */
  unitPrice: number;
  quantity: number;
  /** Promotion fixed when the item was sent (S3). */
  promotionId: string | null;
  /** Sortable timestamp (ISO string). */
  addedAt: string;
  voided: boolean;
  comboId: string | null;
}

/** Preview input: an item that may still be unsent. */
export interface PreviewItem extends EngineItem {
  sent: boolean;
}

/** "Now" already converted to the restaurant timezone. */
export interface LocalClock {
  /** ISO 1 = Monday … 7 = Sunday. */
  isoDay: number;
  /** Minutes since local midnight, 0..1439. */
  minutes: number;
  /** 'YYYY-MM-DD'. */
  date: string;
}

export interface EngineContext<C extends string = string> {
  now: LocalClock;
  channel: C;
}

export type ScheduleReason =
  | 'active'
  | 'paused'
  | 'not_started'
  | 'ended'
  | 'other_day'
  | 'outside_hours'
  | 'manual';

export interface ScheduleState {
  activeNow: boolean;
  /** End of the current window; null when all day or not active. */
  endsAtMinutes: number | null;
  /** Start of the next window later today, when outside hours. */
  nextStartTodayMinutes: number | null;
  reason: ScheduleReason;
}

export interface ItemDiscount {
  orderItemId: string;
  promotionId: string;
  label: string;
  amount: number;
}

export interface ComboDiscount {
  comboId: string;
  orderItemId: string;
  promotionId: string;
  label: string;
  amount: number;
}

export interface BillDiscount {
  promotionId: string;
  label: string;
  amount: number;
}

export interface OrderDiscounts {
  itemDiscounts: ItemDiscount[];
  comboDiscounts: ComboDiscount[];
  billDiscount: BillDiscount | null;
  grossSubtotal: number;
  /** Item + combo discounts. */
  productDiscountTotal: number;
  /** gross − product − bill. */
  netSubtotal: number;
}

export type ComboErrorCode =
  | 'combo_inactive'
  | 'combo_group_missing'
  | 'combo_choice_invalid'
  | 'combo_duplicate_group';

export type ComboValidation = { ok: true } | { ok: false; errors: ComboErrorCode[] };

export interface ComboChoice {
  groupId: string;
  dishId: string;
}

export interface HintContext<C extends string = string> extends EngineContext<C> {
  /** Label of the channel for bill hints, e.g. 'Domicilio'. */
  channelLabel?: string;
}

export type PricingHint =
  | { kind: 'missing_units'; promotionId: string; missing: number; message: string }
  | { kind: 'window_ending'; promotionId: string; minutesLeft: number }
  | { kind: 'bill_minimum'; promotionId: string; missing: number; message: string };
