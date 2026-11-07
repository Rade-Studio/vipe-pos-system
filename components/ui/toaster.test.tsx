import { afterEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react"
import { Toaster } from "./toaster"
import { toast, useToast } from "./use-toast"

// L24: toasts sit at the bottom centre as a deck. Collapsed, only the newest is
// fully visible and up to two older ones peek behind it; hover, focus or a tap
// expands the deck so each one can be read and closed.
afterEach(() => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useToast())
  act(() => {
    result.current.dismiss()
    vi.advanceTimersByTime(5000)
  })
  vi.useRealTimers()
})

function showToasts(count: number) {
  act(() => {
    for (let i = 1; i <= count; i++) toast({ title: `Aviso ${i}` })
  })
}

const item = (title: string) => screen.getByText(title).closest("li")!
const viewport = () => screen.getByRole("region").querySelector("ol")!

describe("Toaster placement", () => {
  it("anchors the viewport at the bottom centre on every breakpoint", () => {
    render(<Toaster />)
    showToasts(1)
    const classes = viewport().className.split(/\s+/)
    expect(classes).toEqual(expect.arrayContaining(["left-1/2", "-translate-x-1/2"]))
    expect(classes.some((c) => c.startsWith("bottom-"))).toBe(true)
    for (const top of ["top-0", "sm:top-0", "right-0", "sm:right-0"]) expect(classes).not.toContain(top)
  })

  it("slides toasts in from the bottom", () => {
    render(<Toaster />)
    showToasts(1)
    expect(item("Aviso 1").className).toContain("slide-in-from-bottom-full")
    expect(item("Aviso 1").className).not.toContain("slide-in-from-top")
  })
})

describe("Toaster deck", () => {
  it("shows at most three toasts with the newest in front", () => {
    render(<Toaster />)
    showToasts(8)
    expect(screen.getAllByRole("status")).toHaveLength(3)
    expect(screen.queryByText("Aviso 5")).toBeNull()
    expect(item("Aviso 8").dataset.stackIndex).toBe("0")
    expect(item("Aviso 7").dataset.stackIndex).toBe("1")
    expect(item("Aviso 6").dataset.stackIndex).toBe("2")
  })

  it("collapses older toasts behind the newest, offset and scaled down", () => {
    render(<Toaster />)
    showToasts(3)
    expect(viewport().dataset.expanded).toBe("false")
    const front = item("Aviso 3").style
    expect(front.getPropertyValue("--stack-y")).toBe("0px")
    expect(front.getPropertyValue("--stack-scale")).toBe("1")
    const back = item("Aviso 1").style
    expect(back.getPropertyValue("--stack-y")).toBe("-16px")
    expect(Number(back.getPropertyValue("--stack-scale"))).toBeLessThan(1)
    expect(Number(item("Aviso 1").style.zIndex)).toBeLessThan(Number(item("Aviso 3").style.zIndex))
  })

  it("expands on hover and collapses when the pointer leaves", () => {
    render(<Toaster />)
    showToasts(3)
    fireEvent.mouseEnter(viewport())
    expect(viewport().dataset.expanded).toBe("true")
    expect(item("Aviso 1").style.getPropertyValue("--stack-y")).toBe("0px")
    expect(item("Aviso 1").style.getPropertyValue("--stack-scale")).toBe("1")
    fireEvent.mouseLeave(viewport())
    expect(viewport().dataset.expanded).toBe("false")
  })

  it("expands on keyboard focus and on tap", () => {
    render(<Toaster />)
    showToasts(2)
    fireEvent.focusIn(item("Aviso 1"))
    expect(viewport().dataset.expanded).toBe("true")
    fireEvent.focusOut(item("Aviso 1"))
    expect(viewport().dataset.expanded).toBe("false")
    fireEvent.pointerDown(item("Aviso 2"))
    expect(viewport().dataset.expanded).toBe("true")
    fireEvent.pointerDown(document.body)
    expect(viewport().dataset.expanded).toBe("false")
  })

  it("closes a toast with its close button", () => {
    render(<Toaster />)
    showToasts(2)
    fireEvent.click(item("Aviso 1").querySelector("[toast-close]")!)
    expect(screen.queryByText("Aviso 1")).toBeNull()
    expect(screen.getByText("Aviso 2")).toBeTruthy()
  })

  it("closes success toasts after 4 s and destructive toasts after 8 s", () => {
    vi.useFakeTimers()
    render(<Toaster />)
    act(() => {
      toast({ title: "Guardado" })
      toast({ title: "Falló", variant: "destructive" })
    })
    act(() => vi.advanceTimersByTime(3900))
    expect(screen.queryByText("Guardado")).not.toBeNull()
    act(() => vi.advanceTimersByTime(200))
    expect(screen.queryByText("Guardado")).toBeNull()
    expect(screen.queryByText("Falló")).not.toBeNull()
    act(() => vi.advanceTimersByTime(4000))
    expect(screen.queryByText("Falló")).toBeNull()
    vi.useRealTimers()
  })

  it("drops motion for users who ask for reduced motion", () => {
    render(<Toaster />)
    showToasts(2)
    const classes = item("Aviso 1").className
    expect(classes).toContain("motion-reduce:transition-none")
    expect(classes).toContain("motion-reduce:animate-none")
  })
})

describe("Toaster lift over bottom action bars", () => {
  afterEach(() => {
    // @ts-expect-error jsdom has no elementsFromPoint; the tests install one.
    delete document.elementsFromPoint
  })

  it("rises just above a bottom bar with actions instead of covering it", () => {
    const send = document.createElement("button")
    send.textContent = "Enviar a cocina (1)"
    document.body.append(send)
    const barTop = window.innerHeight - 120
    send.getBoundingClientRect = () => ({ top: barTop, bottom: window.innerHeight, left: 0, right: 1024 }) as DOMRect
    document.elementsFromPoint = (_x: number, y: number) => (y >= barTop ? [send] : [])
    render(<Toaster />)
    showToasts(1)
    expect(viewport().style.bottom).toBe("112px")
    send.remove()
  })

  function controlInScroller(sticky: boolean) {
    const scroller = document.createElement("div")
    scroller.style.overflowY = "auto"
    Object.defineProperty(scroller, "scrollHeight", { value: 2000 })
    Object.defineProperty(scroller, "clientHeight", { value: 700 })
    const bar = document.createElement("div")
    if (sticky) bar.style.position = "sticky"
    const button = document.createElement("button")
    bar.append(button)
    scroller.append(bar)
    document.body.append(scroller)
    const top = window.innerHeight - 80
    button.getBoundingClientRect = () => ({ top, bottom: top + 44, left: 0, right: 1024 }) as DOMRect
    document.elementsFromPoint = (_x: number, y: number) => (y >= top ? [button] : [])
    return scroller
  }

  it("ignores controls of content that scrolls away under it", () => {
    const scroller = controlInScroller(false)
    render(<Toaster />)
    showToasts(1)
    expect(viewport().style.bottom).toBe("0px")
    scroller.remove()
  })

  it("rises above a sticky bar inside scrolling content", () => {
    const scroller = controlInScroller(true)
    render(<Toaster />)
    showToasts(1)
    expect(viewport().style.bottom).toBe("72px")
    scroller.remove()
  })

  it("stays at the bottom edge when nothing actionable is underneath", () => {
    document.elementsFromPoint = () => [document.body]
    render(<Toaster />)
    showToasts(1)
    expect(viewport().style.bottom).toBe("0px")
  })
})
