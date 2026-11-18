import { fireEvent, render, screen, within } from "@testing-library/react"
import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { LandingPage } from "@/components/landing/LandingPage"
import { LiveFlowSection } from "@/components/landing/LiveFlowSection"
import { flow } from "@/components/landing/content"

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduce && query.includes("reduce"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

afterEach(() => vi.unstubAllGlobals())

const insideAriaHidden = (node: HTMLElement) => node.closest("[aria-hidden='true']") !== null

describe("LiveFlowSection (H-105)", () => {
  it("offers the four steps to assistive tech, in reading order", () => {
    mockReducedMotion(false)
    render(<LiveFlowSection />)
    const steps = screen.getByRole("list", { name: "Cómo funciona, paso a paso" })
    const items = within(steps).getAllByRole("listitem")
    expect(items.map((item) => within(item).getByRole("heading").textContent)).toEqual(flow.map((step) => step.title))
    for (const item of items) expect(insideAriaHidden(item)).toBe(false)
  })

  it("shows every step and no infinite animation with reduced motion", () => {
    mockReducedMotion(true)
    const { container } = render(<LiveFlowSection />)
    for (const step of flow) {
      const title = screen.getByRole("heading", { name: step.title })
      expect(insideAriaHidden(title)).toBe(false)
      expect(title.closest("[class*='sr-only']")).toBeNull()
    }
    expect(container.querySelector(".h-\\[400vh\\]")).toBeNull()
  })
})

describe("Hero motion (H-105)", () => {
  it("stops ping and bounce with reduced motion", () => {
    mockReducedMotion(false)
    const { container } = render(<LandingPage />)
    const infinite = container.querySelectorAll(".animate-ping, .animate-bounce")
    expect(infinite.length).toBeGreaterThan(0)
    for (const node of infinite) expect(node.getAttribute("class")).toMatch(/motion-reduce:animate-none/)
  })
})

describe("LandingPage without JavaScript (H-106)", () => {
  it("ships a noscript rule that reveals every animated block in the server HTML", () => {
    const html = renderToString(<LandingPage />)
    expect(html).toMatch(/<noscript><style>[^<]*\[data-reveal\][^<]*opacity:1 !important/)
    const hidden = html.match(/<[^>]+opacity:0[^>]*>/g) ?? []
    expect(hidden.length).toBeGreaterThan(0)
    // An animated block is either revealed by the rule or swapped for its static copy.
    for (const tag of hidden) expect(tag).toMatch(/data-reveal|data-noscript-hide/)
    expect(html).toMatch(/\[data-noscript-show\]/)
  })
})

describe("LandingPage mobile menu (H-107)", () => {
  it("opens a menu with the six section links and closes on a link", () => {
    mockReducedMotion(false)
    render(<LandingPage />)
    const toggle = screen.getByRole("button", { name: "Abrir menú" })
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    const menu = screen.getByRole("navigation", { name: "Menú" })
    const links = within(menu).getAllByRole("link")
    expect(links.map((link) => link.textContent)).toEqual(["Beneficios", "Cómo funciona", "Roles", "Domicilios", "Ventajas", "Roadmap"])
    fireEvent.click(links[1])
    expect(screen.queryByRole("navigation", { name: "Menú" })).toBeNull()
    expect(screen.getByRole("button", { name: "Abrir menú" })).toHaveAttribute("aria-expanded", "false")
  })

  it("shows the logo from a small image", () => {
    const { container } = render(<LandingPage />)
    expect(container.querySelector("header img")).toHaveAttribute("src", "/vipe-pos-64.png")
  })
})
