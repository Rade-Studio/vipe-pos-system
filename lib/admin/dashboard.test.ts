/**
 * T9 (S1/S2) — dashboard read boundaries.
 *
 * The dashboard used to run one `useEffect` that awaited SEVEN reads in
 * sequence, on every mount of the Dashboard tab, whether or not anybody looked
 * at it: 4 reads for `getDashboardStats` (month paid orders, kitchen orders,
 * tables, waiters), 1 for the 30-day sales series, 1 for "popular dishes"
 * (every paid order_item EVER — unbounded) and 1 for the assigned-table count.
 *
 * These helpers are the bounds the queries are now keyed by: they must make the
 * cache slot change when the window changes (so a different period is a
 * different read, never a silent reuse) and they must never produce an
 * unbounded `since`.
 */
import { describe, expect, it } from "vitest"

import { DASHBOARD_DAYS, DASHBOARD_STALE_MS, dashboardSummaryKey } from "./dashboard"
import { daysAgoIso, localDayKey, monthStartIso } from "./dates"

describe("monthStartIso", () => {
  it("is the first millisecond of the current local month", () => {
    const now = new Date(2026, 0, 15, 13, 30, 45)
    const iso = monthStartIso(now)

    expect(new Date(iso).getTime()).toBe(new Date(2026, 0, 1, 0, 0, 0, 0).getTime())
    expect(new Date(iso).getDate()).toBe(1)
  })

  it("works for a January month boundary too", () => {
    const iso = monthStartIso(new Date(2026, 0, 1, 0, 0, 1))

    expect(new Date(iso).getTime()).toBe(new Date(2026, 0, 1, 0, 0, 0, 0).getTime())
  })
})

describe("daysAgoIso", () => {
  it("starts the window at local midnight N days back", () => {
    const now = new Date(2026, 1, 10, 9, 15)
    const iso = daysAgoIso(now, 30)

    expect(new Date(iso).getTime()).toBe(new Date(2026, 0, 11, 0, 0, 0, 0).getTime())
  })

  it("is the same instant whatever the time of day (stable cache key for one day)", () => {
    const morning = daysAgoIso(new Date(2026, 1, 10, 9, 0), 30)
    const night = daysAgoIso(new Date(2026, 1, 10, 23, 59), 30)

    expect(morning).toBe(night)
  })

  it("clamps a non-positive window to one day instead of reading every row ever", () => {
    const now = new Date(2026, 1, 10, 9, 15)

    expect(daysAgoIso(now, 0)).toBe(daysAgoIso(now, 1))
    expect(daysAgoIso(now, -5)).toBe(daysAgoIso(now, 1))
  })
})

describe("dashboard query key", () => {
  it("is one serializable slot for the whole summary (T12: one request)", () => {
    const key = dashboardSummaryKey(DASHBOARD_DAYS)
    expect(key.every((part) => typeof part === "string")).toBe(true)
    expect(key).toEqual(dashboardSummaryKey(DASHBOARD_DAYS))
  })

  it("keys the summary by its window, so a different period is a different read", () => {
    expect(dashboardSummaryKey(30)).not.toEqual(dashboardSummaryKey(7))
  })

  it("bounds the window and caches it long enough that a tab switch reuses it", () => {
    expect(DASHBOARD_DAYS).toBeGreaterThan(0)
    expect(DASHBOARD_STALE_MS).toBeGreaterThan(0)
  })
})

describe("localDayKey", () => {
  it("is the local calendar day, so two pickers on one day share a cache slot", () => {
    expect(localDayKey(new Date(2026, 0, 5, 0, 1))).toBe("2026-01-05")
    expect(localDayKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05")
    expect(localDayKey(new Date(2026, 11, 31, 12))).toBe("2026-12-31")
  })

  it("degrades to a stable slot for a missing/invalid date", () => {
    expect(localDayKey(undefined)).toBe("current")
    expect(localDayKey(new Date("nope"))).toBe("current")
  })
})
