import { describe, expect, it } from "vitest"
import { shouldReloadAuthProfile } from "./auth-events"

/**
 * T5 (S1): `onAuthStateChange` fires for every token refresh and for the
 * INITIAL_SESSION that duplicates the explicit `getSession()` call in the same
 * effect. Reloading the profile on those duplicates re-queries `profiles` and
 * resets `selectedProfile`, which wipes an admin's impersonated role.
 */
describe("shouldReloadAuthProfile", () => {
  it("reloads on the first SIGNED_IN (no user id seen yet)", () => {
    expect(shouldReloadAuthProfile("SIGNED_IN", null, "u-1")).toBe(true)
  })

  it("does not reload on a SIGNED_IN duplicate for the same user", () => {
    expect(shouldReloadAuthProfile("SIGNED_IN", "u-1", "u-1")).toBe(false)
  })

  it("reloads on SIGNED_IN when the user id changed", () => {
    expect(shouldReloadAuthProfile("SIGNED_IN", "u-1", "u-2")).toBe(true)
  })

  it("reloads on SIGNED_OUT so the identity is cleared", () => {
    expect(shouldReloadAuthProfile("SIGNED_OUT", "u-1", null)).toBe(true)
    expect(shouldReloadAuthProfile("SIGNED_OUT", null, null)).toBe(true)
  })

  it("never reloads on TOKEN_REFRESHED for the same session", () => {
    expect(shouldReloadAuthProfile("TOKEN_REFRESHED", "u-1", "u-1")).toBe(false)
  })

  it("never reloads on the INITIAL_SESSION duplicate of getSession()", () => {
    expect(shouldReloadAuthProfile("INITIAL_SESSION", "u-1", "u-1")).toBe(false)
  })

  it("reloads on any other event only when the user id changed", () => {
    expect(shouldReloadAuthProfile("USER_UPDATED", "u-1", "u-1")).toBe(false)
    expect(shouldReloadAuthProfile("PASSWORD_RECOVERY", "u-1", "u-1")).toBe(false)
    expect(shouldReloadAuthProfile("USER_UPDATED", "u-1", "u-2")).toBe(true)
  })
})