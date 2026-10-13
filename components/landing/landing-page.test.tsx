import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { LandingPage } from "@/components/landing/LandingPage"
import { deliverySteps, pains, roadmap, roles } from "@/components/landing/content"

describe("LandingPage", () => {
  it("renders every pain the product removes, with its solution", () => {
    render(<LandingPage />)
    const section = screen.getByTestId("pains")
    for (const pain of pains) {
      expect(within(section).getByText(pain.before)).toBeInTheDocument()
      expect(within(section).getByText(pain.after)).toBeInTheDocument()
    }
  })

  it("renders the five role views, including deliveries", () => {
    render(<LandingPage />)
    const section = screen.getByTestId("roles")
    expect(roles).toHaveLength(5)
    expect(within(section).getByRole("heading", { name: "Domicilios" })).toBeInTheDocument()
    for (const role of roles) {
      expect(within(section).getByRole("heading", { name: role.name })).toBeInTheDocument()
    }
  })

  it("renders the full roadmap as upcoming work", () => {
    render(<LandingPage />)
    const section = screen.getByTestId("roadmap")
    expect(roadmap).toHaveLength(11)
    for (const item of roadmap) {
      expect(within(section).getByRole("heading", { name: item.title })).toBeInTheDocument()
    }
  })

  it("renders the delivery module with every delivery status", () => {
    render(<LandingPage />)
    const section = screen.getByTestId("delivery")
    expect(within(section).getByRole("heading", { level: 2 })).toHaveTextContent(/domicilio/i)
    expect(deliverySteps.map((step) => step.label)).toEqual([
      "Recibido",
      "En preparación",
      "Listo",
      "En camino",
      "Entregado",
    ])
    const steps = within(section).getByRole("list", { name: "Estados del domicilio" })
    for (const step of deliverySteps) {
      expect(within(steps).getByText(step.label)).toBeInTheDocument()
    }
  })

  it("links the call to action to the portal", () => {
    render(<LandingPage />)
    const links = screen.getAllByRole("link", { name: /entrar al sistema/i })
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) expect(link).toHaveAttribute("href", "/portal")
  })
})
