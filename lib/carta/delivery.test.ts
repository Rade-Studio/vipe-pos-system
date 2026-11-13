import { describe, expect, it } from "vitest"
import { carta, tableCarta } from "@/components/carta/carta-fixtures"
import { orderingMode, type CartLine } from "./cart"
import {
  DELIVERY_STEP,
  cashFromValue,
  deliveryBody,
  deliveryOrderLabel,
  loadTrackingToken,
  phoneInput,
  saveTrackingToken,
  trackingPath,
  validateDelivery,
  whatsappOrderHref,
  whatsappOrderText,
  type DeliveryForm,
} from "./delivery"

/** T7 (S15, S16) — the guest delivery checkout, tracking and the WhatsApp fallback. */

const settings = (c: ReturnType<typeof carta>, s: Partial<ReturnType<typeof carta>["settings"]>) => ({ ...c, settings: { ...c.settings, ...s } })

const LINES: CartLine[] = [
  { key: "a", dishId: "churrasco", name: "Churrasco 300 g", qty: 2, unitPrice: 45900, options: [{ groupId: "g", optionId: "o-arroz", name: "Arroz con coco", price: 3000 }], note: "bien asado" },
  { key: "b", dishId: "coco", name: "Limonada de coco", qty: 1, unitPrice: 9900, options: [], note: null },
]

const FORM: DeliveryForm = {
  name: " Laura Gómez ",
  phone: "3001234567",
  address: "Calle 63 # 9-42, apto 501",
  neighborhood: "Chapinero Alto",
  notes: "",
  payment: "cash",
  cashFrom: "",
}

describe("orderingMode (S15, S16)", () => {
  it("delivery ordering on → delivery, off with WhatsApp → whatsapp, else list; table rules unchanged", () => {
    expect(orderingMode(settings(carta(), { deliveryOrderingEnabled: true }))).toBe("delivery")
    expect(orderingMode(settings(carta(), { deliveryOrderingEnabled: false, whatsapp: "573001234567" }))).toBe("whatsapp")
    expect(orderingMode(settings(carta(), { deliveryOrderingEnabled: false, whatsapp: null }))).toBe("list")
    expect(orderingMode(settings(tableCarta(), { deliveryOrderingEnabled: true, whatsapp: "57300" }))).toBe("list")
    expect(orderingMode(settings(tableCarta(), { deliveryOrderingEnabled: true, tableOrderingEnabled: true }))).toBe("propose")
  })
})

describe("phone input (A4)", () => {
  it("strips spaces and dashes as typed and keeps only digits", () => {
    expect(phoneInput("300 123-4567", "")).toEqual({ value: "3001234567", error: null })
  })

  it("rejects letters inline and keeps the previous value", () => {
    expect(phoneInput("300a", "300")).toEqual({ value: "300", error: "Escribe solo números." })
  })

  it("rejects more than 15 digits", () => {
    expect(phoneInput("1234567890123456", "123456789012345")).toEqual({ value: "123456789012345", error: "Máximo 15 dígitos." })
  })

  it("asks for 7 to 15 digits on submit", () => {
    expect(validateDelivery({ ...FORM, phone: "300123" }, 50000).phone).toBe("Escribe un celular de 10 dígitos, como 300 123 4567.")
    expect(validateDelivery({ ...FORM, phone: "3001234" }, 50000).phone).toBeUndefined()
  })
})

describe("checkout validation (S15)", () => {
  it("needs a name and an address", () => {
    expect(validateDelivery({ ...FORM, name: " L ", address: "Cra" }, 50000)).toEqual({
      name: "Escribe tu nombre.",
      address: "Escribe la dirección completa.",
    })
  })

  it("cash must cover the total; empty is allowed", () => {
    expect(cashFromValue("$100.000")).toBe(100000)
    expect(validateDelivery({ ...FORM, cashFrom: "50.000" }, 53900).cashFrom).toBe("Debe ser igual o mayor que el total ($53.900).")
    expect(validateDelivery({ ...FORM, cashFrom: "53.900" }, 53900)).toEqual({})
    expect(validateDelivery({ ...FORM, cashFrom: "" }, 53900)).toEqual({})
    expect(validateDelivery({ ...FORM, payment: "card", cashFrom: "10" }, 53900)).toEqual({})
  })

  it("builds the API body", () => {
    expect(deliveryBody({ ...FORM, cashFrom: "100.000", notes: " Portería " }, LINES)).toEqual({
      customer: { name: "Laura Gómez", phone: "3001234567", address: "Calle 63 # 9-42, apto 501", neighborhood: "Chapinero Alto" },
      items: [
        { dishId: "churrasco", quantity: 2, optionIds: ["o-arroz"], note: "bien asado" },
        { dishId: "coco", quantity: 1 },
      ],
      payment: { method: "cash", cashFrom: 100000 },
      notes: "Portería",
    })
    expect(deliveryBody({ ...FORM, neighborhood: " ", payment: "transfer", cashFrom: "9" }, LINES.slice(1))).toEqual({
      customer: { name: "Laura Gómez", phone: "3001234567", address: "Calle 63 # 9-42, apto 501" },
      items: [{ dishId: "coco", quantity: 1 }],
      payment: { method: "transfer" },
    })
  })
})

describe("tracking (S15)", () => {
  it("maps the stages to Recibido → Confirmado → En camino → Entregado", () => {
    expect(DELIVERY_STEP.pending).toBe(0)
    expect([DELIVERY_STEP.received, DELIVERY_STEP.preparing, DELIVERY_STEP.ready]).toEqual([1, 1, 1])
    expect(DELIVERY_STEP.out_for_delivery).toBe(2)
    expect(DELIVERY_STEP.delivered).toBe(3)
    expect(deliveryOrderLabel(142)).toBe("D-0142")
    expect(trackingPath("brasa-y-lena", "tok_en")).toBe("/c/brasa-y-lena/d/tok_en")
  })

  it("remembers the last tracking token per slug", () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    }
    saveTrackingToken(storage, "brasa-y-lena", "AbCdEfGhIjKlMnOpQrStUvWx")
    expect(loadTrackingToken(storage, "brasa-y-lena")).toBe("AbCdEfGhIjKlMnOpQrStUvWx")
    expect(loadTrackingToken(storage, "otro")).toBeNull()
    store.set("vipe:carta:delivery:otro", "<script>")
    expect(loadTrackingToken(storage, "otro")).toBeNull()
    saveTrackingToken(storage, "brasa-y-lena", null)
    expect(loadTrackingToken(storage, "brasa-y-lena")).toBeNull()
  })
})

describe("WhatsApp order (S16)", () => {
  it("composes the message and encodes it in the wa.me link", () => {
    const text = whatsappOrderText("Brasa & Leña", LINES, 105700)
    expect(text).toBe("Hola Brasa & Leña, quiero pedir:\n2 × Churrasco 300 g (Arroz con coco)\n1 × Limonada de coco\nTotal aprox.: $105.700")
    expect(whatsappOrderHref("+57 300 123 4567", text)).toBe(`https://wa.me/573001234567?text=${encodeURIComponent(text)}`)
    expect(whatsappOrderHref("573001234567", "a & b")).toBe("https://wa.me/573001234567?text=a%20%26%20b")
  })
})
