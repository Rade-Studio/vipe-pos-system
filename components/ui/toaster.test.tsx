import { describe, expect, it } from "vitest"
import { act, render, screen } from "@testing-library/react"
import { Toaster } from "./toaster"
import { toast } from "./use-toast"

// T21 (L21 f, L23 d): toasts sit at the top centre on every size, so they
// never cover the bottom action bars (send to kitchen, step picker, payment).
describe("Toaster position", () => {
  it("anchors the viewport at the top centre on every breakpoint", () => {
    render(<Toaster />)
    act(() => {
      toast({ title: "✓ 1× Bandeja agregada" })
    })
    const viewport = screen.getByText("✓ 1× Bandeja agregada").closest("ol")!
    const classes = viewport.className.split(/\s+/)
    expect(classes).toEqual(expect.arrayContaining(["top-0", "left-1/2", "-translate-x-1/2"]))
    for (const bottom of ["bottom-0", "sm:bottom-0", "sm:top-auto", "right-0", "sm:right-0"]) {
      expect(classes).not.toContain(bottom)
    }
  })

  it("slides toasts in from the top on every breakpoint", () => {
    render(<Toaster />)
    act(() => {
      toast({ title: "Quitaste 2× Bandeja" })
    })
    const item = screen.getByText("Quitaste 2× Bandeja").closest("li")!
    expect(item.className).not.toContain("slide-in-from-bottom")
  })
})
