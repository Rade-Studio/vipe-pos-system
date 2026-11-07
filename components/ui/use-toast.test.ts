// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { toast, useToast } from "./use-toast"

// L24: at most three toasts are kept (newest first) and each closes on its own:
// success/info after ~4 s, destructive after ~8 s.
afterEach(() => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useToast())
  act(() => {
    result.current.dismiss()
    vi.advanceTimersByTime(5000)
  })
  vi.useRealTimers()
})

describe("toast store", () => {
  it("keeps only the three newest toasts, newest first", () => {
    const { result } = renderHook(() => useToast())
    act(() => {
      for (let i = 1; i <= 8; i++) toast({ title: `Aviso ${i}` })
    })
    expect(result.current.toasts.map((t) => t.title)).toEqual(["Aviso 8", "Aviso 7", "Aviso 6"])
  })

  it("gives success/info toasts 4 s and destructive toasts 8 s", () => {
    const { result } = renderHook(() => useToast())
    act(() => {
      toast({ title: "Guardado" })
      toast({ title: "Falló", variant: "destructive" })
    })
    const byTitle = Object.fromEntries(result.current.toasts.map((t) => [t.title, t.duration]))
    expect(byTitle).toEqual({ Guardado: 4000, Falló: 8000 })
  })

  it("keeps an explicit duration from the caller", () => {
    const { result } = renderHook(() => useToast())
    act(() => {
      toast({ title: "Largo", duration: 12000 })
    })
    expect(result.current.toasts[0].duration).toBe(12000)
  })

  it("removes a dismissed toast from the store shortly after it closes", () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useToast())
    let handle: ReturnType<typeof toast>
    act(() => {
      handle = toast({ title: "Temporal" })
    })
    act(() => handle.dismiss())
    expect(result.current.toasts[0].open).toBe(false)
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(result.current.toasts).toEqual([])
    vi.useRealTimers()
  })
})
