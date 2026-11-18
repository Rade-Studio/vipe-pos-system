import { describe, expect, it, vi } from "vitest"

vi.mock("next/font/google", () => ({ Inter: () => ({ className: "inter" }) }))
vi.mock("@/components/ClientProviders", () => ({ ClientProviders: () => null }))
import { BRAND_NAME } from "@/lib/brand"
import { metadata } from "@/app/layout"

/** H-005: one product name, the same one the root layout announces. */
describe("brand name", () => {
  it("is VipePOS and is the root layout title", () => {
    expect(BRAND_NAME).toBe("VipePOS")
    expect(metadata.title).toBe(BRAND_NAME)
  })
})
