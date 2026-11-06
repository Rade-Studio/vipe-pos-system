/** T24 — the 10 s payment undo: countdown label and the draft kept when the cashier leaves. */
import { describe, expect, it } from "vitest"
import { PAY_UNDO_MS, countdownLabel, keepPendingDraft, takePendingDraft } from "./pay-undo"

describe("pay undo window", () => {
  it("lasts 10 seconds and counts down in m:ss, rounding up", () => {
    expect(PAY_UNDO_MS).toBe(10_000)
    expect(countdownLabel(10_000)).toBe("0:10")
    expect(countdownLabel(7_200)).toBe("0:08")
    expect(countdownLabel(0)).toBe("0:00")
    expect(countdownLabel(-5)).toBe("0:00")
  })

  it("keeps a draft per order and bill, returned once", () => {
    keepPendingDraft("o-1", "sig-a", { tenders: [1] })
    expect(takePendingDraft("o-1", "sig-b")).toBeNull()
    keepPendingDraft("o-1", "sig-a", { tenders: [1] })
    expect(takePendingDraft("o-2", "sig-a")).toBeNull()
    expect(takePendingDraft("o-1", "sig-a")).toEqual({ tenders: [1] })
    expect(takePendingDraft("o-1", "sig-a")).toBeNull()
  })
})
