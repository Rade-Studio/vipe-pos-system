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

/**
 * Waiter access mode (F2) in business_config `waiter_access_mode`: each
 * waiter with their own account (default) or a shared order-taking terminal
 * where each order needs the waiter's PIN. Read by every role, written by the
 * admin through `PUT /config`.
 */
export type WaiterAccessMode = BusinessConfig["waiterAccessMode"]

/** The server default, for screens that render before the config loads. */
export const DEFAULT_WAITER_ACCESS_MODE: WaiterAccessMode = "own_accounts"

export async function fetchWaiterAccessMode(): Promise<WaiterAccessMode> {
  return (await fetchConfig()).waiterAccessMode
}

/** Admin: saves only the mode and returns it. */
export async function saveWaiterAccessMode(mode: WaiterAccessMode): Promise<WaiterAccessMode> {
  return (await saveConfig({ waiterAccessMode: mode })).waiterAccessMode
}

/**
 * "Permitir que el supervisor se autorice a sí mismo" (F1, L14) in
 * business_config `allow_self_authorization`: off by default, so another
 * supervisor authorizes every cancellation or void; when on, a supervisor may
 * use their own PIN and the event is flagged self-authorized in the audit.
 * Read by every role, written by the admin through `PUT /config`.
 */
export async function fetchAllowSelfAuthorization(): Promise<boolean> {
  return (await fetchConfig()).allowSelfAuthorization
}

/** Admin: saves only the setting and returns it. */
export async function saveAllowSelfAuthorization(allow: boolean): Promise<boolean> {
  return (await saveConfig({ allowSelfAuthorization: allow })).allowSelfAuthorization
}
