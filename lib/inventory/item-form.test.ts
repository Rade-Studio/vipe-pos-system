import { describe, expect, it } from "vitest"

import type { InventoryItem } from "@/lib/supabase/inventory/types"
import {
  emptyItemForm,
  fromItem,
  hasErrors,
  purchaseFactorHelper,
  toInput,
  toOpening,
  validateItemForm,
} from "./item-form"

const item: InventoryItem = {
  id: "i1",
  sku: "MP-0001",
  name: "Tomate",
  description: null,
  kind: "raw",
  unit: "kg",
  barcode: "770123",
  cost: 4200,
  stock: 12.5,
  minStock: 2,
  maxStock: 20,
  purchaseUnit: "caja",
  purchaseFactor: 10,
  defaultSupplierId: "s1",
  trackLots: true,
  shelfLifeDays: 7,
  isActive: true,
  categoryId: "c1",
  categoryName: "Verduras",
}

const valid = () => ({ ...emptyItemForm(), name: "Queso", unit: "kg" })

describe("validateItemForm", () => {
  it("accepts a minimal valid form", () => {
    expect(hasErrors(validateItemForm(valid(), "create"))).toBe(false)
  })

  it("requires name and unit", () => {
    const errors = validateItemForm({ ...emptyItemForm(), name: "  ", unit: "" }, "create")
    expect(errors.name).toBe("El nombre es obligatorio")
    expect(errors.unit).toBe("Selecciona una unidad")
  })

  it("rejects negative or non-numeric minimum and a maximum below the minimum", () => {
    expect(validateItemForm({ ...valid(), minStock: "-1" }, "create").minStock).toBe("El mínimo no puede ser negativo")
    expect(validateItemForm({ ...valid(), minStock: "abc" }, "create").minStock).toBe("Ingresa un número válido")
    expect(validateItemForm({ ...valid(), minStock: "5", maxStock: "3" }, "create").maxStock).toBe(
      "El máximo debe ser mayor o igual al mínimo",
    )
    expect(validateItemForm({ ...valid(), minStock: "5", maxStock: "5" }, "create").maxStock).toBeUndefined()
  })

  it("validates the SKU format only when one is typed", () => {
    expect(validateItemForm({ ...valid(), sku: "" }, "create").sku).toBeUndefined()
    expect(validateItemForm({ ...valid(), sku: "mp-01" }, "create").sku).toBeUndefined()
    expect(validateItemForm({ ...valid(), sku: "M" }, "create").sku).toBe(
      "SKU no válido: 2 a 32 caracteres, letras, números y guiones",
    )
    expect(validateItemForm({ ...valid(), sku: "-AB" }, "create").sku).toBeDefined()
  })

  it("requires a positive factor when a purchase unit is set", () => {
    expect(validateItemForm({ ...valid(), purchaseUnit: "caja", purchaseFactor: "0" }, "create").purchaseFactor).toBe(
      "El factor debe ser mayor que cero",
    )
    expect(validateItemForm({ ...valid(), purchaseUnit: "caja", purchaseFactor: "24" }, "create").purchaseFactor).toBeUndefined()
  })

  it("requires whole positive shelf-life days", () => {
    expect(validateItemForm({ ...valid(), shelfLifeDays: "1.5" }, "create").shelfLifeDays).toBe(
      "La vida útil debe ser un número entero de días mayor que cero",
    )
    expect(validateItemForm({ ...valid(), shelfLifeDays: "" }, "create").shelfLifeDays).toBeUndefined()
  })

  it("validates initial stock and cost only on create", () => {
    const bad = { ...valid(), initialStock: "-2", initialCost: "-1" }
    const created = validateItemForm(bad, "create")
    expect(created.initialStock).toBe("El stock inicial no puede ser negativo")
    expect(created.initialCost).toBe("El costo no puede ser negativo")
    expect(hasErrors(validateItemForm(bad, "edit"))).toBe(false)
  })
})

describe("toInput", () => {
  it("trims, parses numbers with comma decimals, uppercases the SKU and nulls empty optionals", () => {
    const input = toInput({ ...valid(), name: " Queso ", sku: " mp-9 ", minStock: "1,5", maxStock: "" })
    expect(input).toEqual({
      name: "Queso",
      kind: "raw",
      unit: "kg",
      sku: "MP-9",
      barcode: null,
      categoryId: null,
      minStock: 1.5,
      maxStock: null,
      defaultSupplierId: null,
      purchaseUnit: null,
      purchaseFactor: 1,
      trackLots: false,
      shelfLifeDays: null,
      isActive: true,
    })
  })

  it("never carries stock or cost", () => {
    const input = toInput({ ...fromItem(item), initialStock: "5", initialCost: "100" }) as unknown as Record<string, unknown>
    expect(input).not.toHaveProperty("stock")
    expect(input).not.toHaveProperty("cost")
    expect(input).not.toHaveProperty("initialStock")
  })

  it("omits an empty SKU so the server assigns one", () => {
    expect(toInput(valid())).not.toHaveProperty("sku")
  })
})

describe("fromItem", () => {
  it("round-trips the editable fields", () => {
    const values = fromItem(item)
    expect(values.name).toBe("Tomate")
    expect(values.minStock).toBe("2")
    expect(values.maxStock).toBe("20")
    expect(values.purchaseFactor).toBe("10")
    expect(values.shelfLifeDays).toBe("7")
    expect(toInput(values)).toMatchObject({ sku: "MP-0001", barcode: "770123", purchaseUnit: "caja", trackLots: true })
  })
})

describe("toOpening", () => {
  it("returns the opening movement only when initial stock is positive", () => {
    expect(toOpening({ ...valid(), initialStock: "" })).toBeNull()
    expect(toOpening({ ...valid(), initialStock: "0" })).toBeNull()
    expect(toOpening({ ...valid(), initialStock: "3", initialCost: "1200" })).toEqual({ quantity: 3, unitCost: 1200 })
    expect(toOpening({ ...valid(), initialStock: "3", initialCost: "" })).toEqual({ quantity: 3, unitCost: null })
  })
})

describe("purchaseFactorHelper", () => {
  it("describes the conversion", () => {
    expect(purchaseFactorHelper({ ...valid(), unit: "unidad", purchaseUnit: "caja", purchaseFactor: "24" })).toBe(
      "1 caja = 24 unidad",
    )
    expect(purchaseFactorHelper({ ...valid(), purchaseUnit: "", purchaseFactor: "24" })).toBeNull()
  })
})
