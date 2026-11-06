import { type BusinessConfig, fetchConfig, saveConfig } from "./config"

/**
 * Late thresholds (T17) stored in business_config (`kitchen_late_minutes`,
 * `delivery_late_minutes`): whole minutes 1..240, read by every staff role,
 * written by the admin through `PUT /config`. The server fills the defaults.
 */

export type LateThresholds = Pick<BusinessConfig, "kitchenLateMinutes" | "deliveryLateMinutes">

/** The server defaults, for screens that render before the config loads. */
export const DEFAULT_LATE_THRESHOLDS: LateThresholds = { kitchenLateMinutes: 25, deliveryLateMinutes: 45 }

export const lateThresholdsOf = (config: LateThresholds): LateThresholds => ({
  kitchenLateMinutes: config.kitchenLateMinutes,
  deliveryLateMinutes: config.deliveryLateMinutes,
})

export async function fetchLateThresholds(): Promise<LateThresholds> {
  return lateThresholdsOf(await fetchConfig())
}

/** Admin: saves only the given threshold(s) and returns both. */
export async function saveLateThresholds(changes: Partial<LateThresholds>): Promise<LateThresholds> {
  return lateThresholdsOf(await saveConfig(changes))
}
