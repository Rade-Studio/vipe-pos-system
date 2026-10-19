/**
 * Pure draft logic shared by the settings pages: each page edits a local copy
 * of some `useConfigStore` keys and the SaveBar shows only while that copy
 * differs from the saved values.
 */

export interface SettingsValues {
  tipPercentage: number
  taxPercentage: number
  priceSuggestion: number
  inventoryControlEnabled: boolean
  businessName: string
  businessAddress: string
  businessPhone: string
  businessNIT: string
}

export type SettingsKey = keyof SettingsValues

export function pickSettings<K extends SettingsKey>(source: SettingsValues, keys: readonly K[]): Pick<SettingsValues, K> {
  const picked = {} as Pick<SettingsValues, K>
  for (const key of keys) picked[key] = source[key]
  return picked
}

export function changedSettingKeys<T extends Partial<SettingsValues>>(saved: T, draft: T): (keyof T)[] {
  return (Object.keys(draft) as (keyof T)[]).filter((key) => !Object.is(saved[key], draft[key]))
}

export function isDraftDirty<T extends Partial<SettingsValues>>(saved: T, draft: T): boolean {
  return changedSettingKeys(saved, draft).length > 0
}

/** Parses a numeric input and clamps it to `[min, max]`; `null` when it is not a number. */
export function clampSetting(raw: string, { min, max }: { min: number; max: number }): number | null {
  if (raw.trim() === "") return null
  const value = Number(raw)
  if (!Number.isFinite(value)) return null
  return Math.min(max, Math.max(min, value))
}

/** Same arithmetic as the cart (store/useCartStore.ts): tax and tip on the subtotal, rounded. */
export function exampleBill(subtotal: number, taxPercentage: number, tipPercentage: number) {
  const tax = Math.round(subtotal * (taxPercentage / 100))
  const tip = Math.round(subtotal * (tipPercentage / 100))
  return { subtotal, tax, tip, total: subtotal + tax + tip }
}
