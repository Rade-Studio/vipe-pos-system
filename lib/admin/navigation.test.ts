import { describe, expect, it } from "vitest"

import {
  ADMIN_NAV_GROUPS,
  ADMIN_SECTIONS,
  DEFAULT_ADMIN_SECTION,
  getAdminSection,
  groupOfSection,
  parseSectionHash,
  sectionsInGroup,
  serializeSectionHash,
} from "./navigation"

describe("admin navigation registry", () => {
  it("declares the four groups in sidebar order", () => {
    expect(ADMIN_NAV_GROUPS.map((group) => group.label)).toEqual([
      "General",
      "Catálogo",
      "Inventario",
      "Configuración",
    ])
  })

  it("places every section of the design in its group, in order", () => {
    const labels = (groupId: string) => sectionsInGroup(groupId as never).map((section) => section.label)

    expect(labels("general")).toEqual(["Resumen", "Órdenes", "Mesas", "Caja"])
    expect(labels("catalog")).toEqual(["Menú", "Fórmulas"])
    expect(labels("inventory")).toEqual([
      "Resumen",
      "Artículos",
      "Movimientos",
      "Compras",
      "Producción",
      "Conteos",
      "Bodegas",
    ])
    expect(labels("settings")).toEqual([
      "Negocio",
      "Impuestos y propinas",
      "Inventario",
      "Métodos de pago",
      "Domicilios",
      "Personal",
    ])
  })

  it("has unique section ids and every section belongs to a declared group", () => {
    const ids = ADMIN_SECTIONS.map((section) => section.id)
    expect(new Set(ids).size).toBe(ids.length)
    const groupIds = new Set(ADMIN_NAV_GROUPS.map((group) => group.id))
    for (const section of ADMIN_SECTIONS) expect(groupIds.has(section.group)).toBe(true)
  })

  it("resolves the group of a section", () => {
    expect(groupOfSection("orders").label).toBe("General")
    expect(groupOfSection("inventory/items").label).toBe("Inventario")
    expect(groupOfSection("settings/taxes").label).toBe("Configuración")
    expect(getAdminSection("inventory/items").label).toBe("Artículos")
  })
})

describe("parseSectionHash / serializeSectionHash", () => {
  it("defaults to Resumen", () => {
    expect(DEFAULT_ADMIN_SECTION).toBe("overview")
    expect(parseSectionHash("")).toBe("overview")
    expect(parseSectionHash("#")).toBe("overview")
  })

  it("parses a known hash with or without the leading #", () => {
    expect(parseSectionHash("#inventory/items")).toBe("inventory/items")
    expect(parseSectionHash("settings/taxes")).toBe("settings/taxes")
    expect(parseSectionHash("#orders")).toBe("orders")
  })

  it("tolerates a trailing slash, surrounding spaces and URL encoding", () => {
    expect(parseSectionHash("#inventory/items/")).toBe("inventory/items")
    expect(parseSectionHash("  #cash  ")).toBe("cash")
    expect(parseSectionHash("#inventory%2Fitems")).toBe("inventory/items")
  })

  it("maps a bare group hash to the first section of that group", () => {
    expect(parseSectionHash("#inventory")).toBe("inventory/overview")
    expect(parseSectionHash("#settings")).toBe("settings/business")
  })

  it("falls back to the default section for an unknown hash", () => {
    expect(parseSectionHash("#nope")).toBe("overview")
    expect(parseSectionHash("#inventory/unknown")).toBe("overview")
    expect(parseSectionHash("#%E0%A4%A")).toBe("overview")
  })

  it("round-trips every section", () => {
    for (const section of ADMIN_SECTIONS) {
      expect(serializeSectionHash(section.id)).toBe(`#${section.id}`)
      expect(parseSectionHash(serializeSectionHash(section.id))).toBe(section.id)
    }
  })
})
