import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "./errors"

/**
 * T11 (S3, S4) — delivery through the typed API client instead of Supabase:
 * request paths and bodies (camelCase; the server maps them onto
 * `create_delivery_order` / `set_delivery_status`), the 404 -> `null` lookup,
 * and the API error body -> `DeliveryServiceError.kind` mapping, keeping the
 * server message verbatim for the `card-actions.ts` regexes.
 */

const api = vi.hoisted(() => ({
  GET: vi.fn(),
  POST: vi.fn(),
  PATCH: vi.fn(),
}))
vi.mock("@/lib/api/client", () => ({ api }))

import {
  DeliveryServiceError,
  cancelDelivery,
  createCourier,
  createDeliveryOrder,
  deliveryErrorOf,
  findCustomerByPhone,
  getClosedTodaySummary,
  listActiveDeliveries,
  listCouriers,
  returnCourier,
  setDeliveryStatus,
  updateCourier,
} from "./delivery"
import { rejectionMessage } from "@/lib/delivery/card-actions"
import type { CreateDeliveryOrderInput } from "@/lib/delivery/types"

const customer = {
  id: "c-1",
  phone: "3101234567",
  name: "Ana",
  notes: null,
  createdAt: "2026-11-04T12:00:00.000Z",
  updatedAt: "2026-11-04T12:00:00.000Z",
}
const address = {
  id: "a-1",
  customerId: "c-1",
  label: null,
  addressLine: "Calle 5 # 10-20",
  neighborhood: null,
  reference: null,
  isDefault: true,
  createdAt: "2026-11-04T12:00:00.000Z",
  updatedAt: "2026-11-04T12:00:00.000Z",
}
const courier = {
  id: "k-1",
  name: "Pedro",
  phone: null,
  isActive: true,
  createdAt: "2026-11-04T12:00:00.000Z",
  updatedAt: "2026-11-04T12:00:00.000Z",
}
const delivery = {
  orderId: "o-1",
  customerId: "c-1",
  customerName: "Ana",
  customerPhone: "3101234567",
  addressLine: "Calle 5 # 10-20",
  neighborhood: null,
  addressReference: null,
  deliveryFee: 3000,
  paymentMode: "cash_on_delivery",
  cashChangeFor: 50000,
  courierId: null,
  status: "received",
  failureReason: null,
  notes: null,
  dispatchedAt: null,
  deliveredAt: null,
  failedAt: null,
  cancelledAt: null,
  createdAt: "2026-11-04T12:00:00.000Z",
  updatedAt: "2026-11-04T12:00:00.000Z",
}
const createdResult = {
  orderId: "o-1",
  customerId: "c-1",
  addressId: "a-2",
  delivery,
  consumption: { orderId: "o-1", enabled: true, consumedItems: 1, totalCost: 0, shortages: [] },
  printJob: { id: "p-1", kind: "command", createdAt: "2026-11-04T12:00:00.000Z" },
}

const apiError = (status: number, message: string, code?: string) =>
  new ApiError(status, "Error", message, code ? { statusCode: status, message, code } : { statusCode: status, message })

const kindOf = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(DeliveryServiceError)
    return (error as DeliveryServiceError).kind
  }
  throw new Error("expected a rejection")
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
})

describe("findCustomerByPhone", () => {
  it("reads GET /api/delivery/customers with the normalised phone", async () => {
    api.GET.mockResolvedValue({ data: { customer, addresses: [address] } })
    await expect(findCustomerByPhone("+57 310 123 4567")).resolves.toEqual({ customer, addresses: [address] })
    expect(api.GET).toHaveBeenCalledWith("/api/delivery/customers", { params: { query: { phone: "3101234567" } } })
  })

  it("maps the 404 of an unknown phone back to null", async () => {
    api.GET.mockRejectedValue(apiError(404, "Customer not found"))
    await expect(findCustomerByPhone("3101234567")).resolves.toBeNull()
  })

  it("treats only the API's own code-less `Customer not found` 404 as no customer", async () => {
    api.GET.mockRejectedValueOnce(apiError(404, "Cannot GET /api/delivery/customers"))
    await expect(kindOf(findCustomerByPhone("3101234567"))).resolves.toBe("not-found")
    api.GET.mockRejectedValueOnce(apiError(404, "Customer not found", "P0002"))
    await expect(kindOf(findCustomerByPhone("3101234567"))).resolves.toBe("not-found")
  })

  it("maps a 422 to invalid-input and a 500 to unknown, message verbatim", async () => {
    api.GET.mockRejectedValueOnce(apiError(422, "Phone must have 7 to 15 digits"))
    const invalidCaught = (await findCustomerByPhone("3101234567").catch((e: unknown) => e)) as DeliveryServiceError
    expect([invalidCaught.kind, invalidCaught.message]).toEqual(["invalid-input", "Phone must have 7 to 15 digits"])
    api.GET.mockRejectedValueOnce(apiError(500, "Internal server error"))
    await expect(kindOf(findCustomerByPhone("3101234567"))).resolves.toBe("unknown")
  })

  it("rejects an invalid phone without a request", async () => {
    await expect(kindOf(findCustomerByPhone("12"))).resolves.toBe("invalid-input")
    expect(api.GET).not.toHaveBeenCalled()
  })

  it("maps a 403 to not-authorized", async () => {
    api.GET.mockRejectedValue(apiError(403, "Forbidden"))
    await expect(kindOf(findCustomerByPhone("3101234567"))).resolves.toBe("not-authorized")
  })
})

describe("couriers", () => {
  it("lists with activeOnly as a query flag", async () => {
    api.GET.mockResolvedValue({ data: [courier] })
    await expect(listCouriers({ activeOnly: true })).resolves.toEqual([courier])
    expect(api.GET).toHaveBeenCalledWith("/api/delivery/couriers", { params: { query: { activeOnly: "true" } } })
    await listCouriers({ activeOnly: false })
    expect(api.GET).toHaveBeenLastCalledWith("/api/delivery/couriers", { params: { query: { activeOnly: "false" } } })
  })

  it("creates with the trimmed name and normalised phone, null when blank", async () => {
    api.POST.mockResolvedValue({ data: courier })
    await expect(createCourier({ name: "  Pedro ", phone: "+57 310 123 4567" })).resolves.toEqual(courier)
    expect(api.POST).toHaveBeenCalledWith("/api/delivery/couriers", { body: { name: "Pedro", phone: "3101234567" } })
    await createCourier({ name: "Pedro", phone: "  " })
    expect(api.POST).toHaveBeenLastCalledWith("/api/delivery/couriers", { body: { name: "Pedro", phone: null } })
  })

  it("rejects an invalid courier without a request", async () => {
    await expect(kindOf(createCourier({ name: " ", phone: "" }))).resolves.toBe("invalid-input")
    expect(api.POST).not.toHaveBeenCalled()
  })

  it("patches only the supplied fields by id", async () => {
    api.PATCH.mockResolvedValue({ data: { ...courier, isActive: false } })
    await updateCourier("k-1", { isActive: false })
    expect(api.PATCH).toHaveBeenCalledWith("/api/delivery/couriers/{id}", {
      params: { path: { id: "k-1" } },
      body: { isActive: false },
    })
    await updateCourier("k-1", { name: " Juan ", phone: "" })
    expect(api.PATCH).toHaveBeenLastCalledWith("/api/delivery/couriers/{id}", {
      params: { path: { id: "k-1" } },
      body: { name: "Juan", phone: null },
    })
  })

  it("rejects an empty patch without a request; a 404 is not-found", async () => {
    await expect(kindOf(updateCourier("k-1", {}))).resolves.toBe("invalid-input")
    expect(api.PATCH).not.toHaveBeenCalled()
    api.PATCH.mockRejectedValue(apiError(404, "Courier not found"))
    await expect(kindOf(updateCourier("k-1", { isActive: true }))).resolves.toBe("not-found")
  })
})

describe("createDeliveryOrder", () => {
  const cashInput: CreateDeliveryOrderInput = {
    customer: { phone: "3101234567", name: "Ana" },
    address: { addressLine: "Calle 9 # 1-2", neighborhood: "Centro", reference: null, label: "Casa", save: true },
    items: [
      { dishId: "d-1", quantity: 2, comments: "sin cebolla" },
      { dishId: "d-2", quantity: 1 },
    ],
    deliveryFee: 3000,
    paymentMode: "cash_on_delivery",
    cashChangeFor: 50000,
    notes: "timbre",
  }

  it("POSTs one /api/delivery/orders with the camelCase body and returns consumption and printJob", async () => {
    api.POST.mockResolvedValue({ data: createdResult })
    await expect(createDeliveryOrder(cashInput)).resolves.toEqual(createdResult)
    expect(api.POST).toHaveBeenCalledTimes(1)
    expect(api.POST).toHaveBeenCalledWith("/api/delivery/orders", {
      body: {
        customer: { phone: "3101234567", name: "Ana" },
        address: { addressLine: "Calle 9 # 1-2", neighborhood: "Centro", reference: null, label: "Casa", save: true },
        items: [
          { dishId: "d-1", quantity: 2, comments: "sin cebolla" },
          { dishId: "d-2", quantity: 1 },
        ],
        deliveryFee: 3000,
        paymentMode: "cash_on_delivery",
        cashChangeFor: 50000,
        notes: "timbre",
      },
    })
  })

  it("forwards each item's modifiers [{optionId}] (F7)", async () => {
    api.POST.mockResolvedValue({ data: createdResult })
    await createDeliveryOrder({ ...cashInput, items: [{ dishId: "d-1", quantity: 1, modifiers: [{ optionId: "o-1" }] }] })
    expect(api.POST.mock.calls[0]![1].body.items).toEqual([{ dishId: "d-1", quantity: 1, modifiers: [{ optionId: "o-1" }] }])
  })

  it("sends an existing customer and address by id, cashChangeFor null and notes null for prepaid", async () => {
    api.POST.mockResolvedValue({ data: createdResult })
    await createDeliveryOrder({
      customer: { id: "c-1" },
      address: { id: "a-1" },
      items: [{ dishId: "d-1", quantity: 1 }],
      deliveryFee: 0,
      paymentMode: "prepaid",
    })
    expect(api.POST).toHaveBeenCalledWith("/api/delivery/orders", {
      body: {
        customer: { id: "c-1" },
        address: { id: "a-1" },
        items: [{ dishId: "d-1", quantity: 1 }],
        deliveryFee: 0,
        paymentMode: "prepaid",
        cashChangeFor: null,
        notes: null,
      },
    })
  })

  it("sends cashChangeFor null for cash on delivery without change", async () => {
    api.POST.mockResolvedValue({ data: createdResult })
    const { cashChangeFor: _omitted, ...withoutChange } = cashInput
    await createDeliveryOrder(withoutChange)
    expect(api.POST.mock.calls[0]![1].body).toEqual({
      customer: { phone: "3101234567", name: "Ana" },
      address: { addressLine: "Calle 9 # 1-2", neighborhood: "Centro", reference: null, label: "Casa", save: true },
      items: [
        { dishId: "d-1", quantity: 2, comments: "sin cebolla" },
        { dishId: "d-2", quantity: 1 },
      ],
      deliveryFee: 3000,
      paymentMode: "cash_on_delivery",
      cashChangeFor: null,
      notes: "timbre",
    })
  })

  it("rejects empty items, a negative fee and cashChangeFor on prepaid without a request", async () => {
    await expect(kindOf(createDeliveryOrder({ ...cashInput, items: [] }))).resolves.toBe("invalid-input")
    await expect(kindOf(createDeliveryOrder({ ...cashInput, deliveryFee: -1 }))).resolves.toBe("invalid-input")
    await expect(kindOf(createDeliveryOrder({ ...cashInput, paymentMode: "prepaid" }))).resolves.toBe("invalid-input")
    expect(api.POST).not.toHaveBeenCalled()
  })

  it("maps the API body code to the kind and keeps the message verbatim", async () => {
    const cases: Array<[ApiError, string]> = [
      [apiError(403, "not allowed", "42501"), "not-authorized"],
      [apiError(404, "dish not found", "P0002"), "not-found"],
      [apiError(422, "items must not be empty", "P0001"), "rejected"],
      [apiError(409, "duplicate", "23505"), "rejected"],
      [apiError(422, "quantity out of range", "22023"), "invalid-input"],
      [apiError(422, "Invalid data", "23514"), "invalid-input"],
      [apiError(422, "Invalid data", "23503"), "unknown"],
      [apiError(422, "items: Required"), "invalid-input"],
      [apiError(404, "Courier not found"), "not-found"],
      [apiError(404, "Customer not found", "P0002"), "not-found"],
      [apiError(403, "Permission denied", "42501"), "not-authorized"],
      [apiError(409, "Conflict"), "rejected"],
      [apiError(401, "Unauthorized"), "not-authorized"],
      [apiError(403, "Forbidden"), "not-authorized"],
      [apiError(500, "Internal server error"), "unknown"],
    ]
    for (const [error, kind] of cases) {
      api.POST.mockRejectedValueOnce(error)
      const caught = await createDeliveryOrder(cashInput).catch((e: unknown) => e)
      expect(caught).toBeInstanceOf(DeliveryServiceError)
      expect((caught as DeliveryServiceError).kind).toBe(kind)
      expect((caught as DeliveryServiceError).message).toBe(error.message)
      expect((caught as DeliveryServiceError).cause).toBe(error)
    }
  })
})

describe("setDeliveryStatus", () => {
  it("POSTs the action, courier and reason to /api/delivery/orders/{id}/status and returns the row", async () => {
    api.POST.mockResolvedValue({ data: { ...delivery, status: "out_for_delivery", courierId: "k-1" } })
    await expect(setDeliveryStatus({ orderId: "o-1", action: "dispatch", courierId: "k-1" })).resolves.toMatchObject({
      status: "out_for_delivery",
      courierId: "k-1",
    })
    expect(api.POST).toHaveBeenCalledWith("/api/delivery/orders/{id}/status", {
      params: { path: { id: "o-1" } },
      body: { action: "dispatch", courierId: "k-1", reason: null },
    })
    await setDeliveryStatus({ orderId: "o-1", action: "fail", reason: "No contesta" })
    expect(api.POST).toHaveBeenLastCalledWith("/api/delivery/orders/{id}/status", {
      params: { path: { id: "o-1" } },
      body: { action: "fail", courierId: null, reason: "No contesta" },
    })
  })

  it("rejects a dispatch without courier and a fail without reason without a request", async () => {
    await expect(kindOf(setDeliveryStatus({ orderId: "o-1", action: "dispatch" }))).resolves.toBe("invalid-input")
    await expect(kindOf(setDeliveryStatus({ orderId: "o-1", action: "fail", reason: " " }))).resolves.toBe(
      "invalid-input",
    )
    expect(api.POST).not.toHaveBeenCalled()
  })

  it("keeps the server messages the card-actions regexes match", async () => {
    const messages = [
      [
        "set_delivery_status: delivery for order o-1 is already in state 'ready'",
        "El domicilio ya cambió de estado. El tablero se actualizará.",
      ],
      [
        "set_delivery_status: action 'deliver' is not allowed from state 'received'",
        "El domicilio ya cambió de estado. El tablero se actualizará.",
      ],
      [
        "set_delivery_status: order o-1 already has a payment",
        "No se puede cancelar: el pedido ya tiene un pago registrado",
      ],
    ] as const
    for (const [server, spanish] of messages) {
      api.POST.mockRejectedValueOnce(apiError(422, server, "P0001"))
      const caught = (await setDeliveryStatus({ orderId: "o-1", action: "cancel" }).catch((e: unknown) => e)) as DeliveryServiceError
      expect(caught.kind).toBe("rejected")
      expect(caught.message).toBe(server)
      expect(rejectionMessage(caught.message)).toBe(spanish)
    }
  })
})

describe("T19 dispatch console details", () => {
  const history = { ordersCount: 14, lastOrderAt: "2026-10-31T19:00:00.000Z", lastAddress: { addressLine: "Calle 5", neighborhood: null, reference: null } }

  it("findCustomerByPhone returns the customer history", async () => {
    api.GET.mockResolvedValue({ data: { customer, addresses: [address], history } })
    await expect(findCustomerByPhone("3101234567")).resolves.toEqual({ customer, addresses: [address], history })
  })

  it("createDeliveryOrder sends prepaidMethodId on a prepaid order and refuses it on cash on delivery without a request", async () => {
    api.POST.mockResolvedValue({ data: createdResult })
    await createDeliveryOrder({
      customer: { id: "c-1" },
      address: { id: "a-1" },
      items: [{ dishId: "d-1", quantity: 1 }],
      deliveryFee: 6500,
      paymentMode: "prepaid",
      prepaidMethodId: "m-1",
    })
    expect(api.POST).toHaveBeenCalledWith("/api/delivery/orders", {
      body: {
        customer: { id: "c-1" },
        address: { id: "a-1" },
        items: [{ dishId: "d-1", quantity: 1 }],
        deliveryFee: 6500,
        paymentMode: "prepaid",
        cashChangeFor: null,
        notes: null,
        prepaidMethodId: "m-1",
      },
    })
    api.POST.mockClear()
    await expect(
      kindOf(
        createDeliveryOrder({
          customer: { id: "c-1" },
          address: { id: "a-1" },
          items: [{ dishId: "d-1", quantity: 1 }],
          deliveryFee: 0,
          paymentMode: "cash_on_delivery",
          prepaidMethodId: "m-1",
        }),
      ),
    ).resolves.toBe("invalid-input")
    expect(api.POST).not.toHaveBeenCalled()
  })

  it("setDeliveryStatus sends the courier ETA and trimmed location with dispatch", async () => {
    api.POST.mockResolvedValue({ data: { ...delivery, status: "out_for_delivery" } })
    await setDeliveryStatus({
      orderId: "o-1",
      action: "dispatch",
      courierId: "k-1",
      courierEta: "2026-11-06T18:25:00.000Z",
      courierLocation: "  Laureles ",
    })
    expect(api.POST).toHaveBeenCalledWith("/api/delivery/orders/{id}/status", {
      params: { path: { id: "o-1" } },
      body: { action: "dispatch", courierId: "k-1", reason: null, courierEta: "2026-11-06T18:25:00.000Z", courierLocation: "Laureles" },
    })
  })

  it("setDeliveryStatus refuses an ETA or location on another action and a location over 60 characters without a request", async () => {
    await expect(
      kindOf(setDeliveryStatus({ orderId: "o-1", action: "deliver", courierEta: "2026-11-06T18:25:00.000Z" })),
    ).resolves.toBe("invalid-input")
    await expect(kindOf(setDeliveryStatus({ orderId: "o-1", action: "cancel", courierLocation: "Laureles" }))).resolves.toBe(
      "invalid-input",
    )
    await expect(
      kindOf(setDeliveryStatus({ orderId: "o-1", action: "dispatch", courierId: "k-1", courierLocation: "x".repeat(61) })),
    ).resolves.toBe("invalid-input")
    expect(api.POST).not.toHaveBeenCalled()
  })

  it("returnCourier POSTs /api/delivery/orders/{id}/return and keeps the server rejection verbatim", async () => {
    api.POST.mockResolvedValue({ data: { ...delivery, status: "delivered", returnedAt: "2026-11-06T18:40:00.000Z" } })
    await expect(returnCourier("o-1")).resolves.toMatchObject({ returnedAt: "2026-11-06T18:40:00.000Z" })
    expect(api.POST).toHaveBeenCalledWith("/api/delivery/orders/{id}/return", { params: { path: { id: "o-1" } } })
    const message = "return_courier: the courier of order o-1 already returned"
    api.POST.mockRejectedValueOnce(apiError(422, message, "P0001"))
    const caught = (await returnCourier("o-1").catch((e: unknown) => e)) as DeliveryServiceError
    expect(caught.kind).toBe("rejected")
    expect(caught.message).toBe(message)
    await expect(kindOf(returnCourier(""))).resolves.toBe("invalid-input")
  })

  it("cancelDelivery POSTs the audited cancel with the reason and the authorization, and keeps the ApiError code (F3b)", async () => {
    api.POST.mockResolvedValue({ data: { ...delivery, status: "cancelled" } })
    const body = { reason: "customer_left" as const, reasonText: null, authorizationId: "auth-1" }
    await expect(cancelDelivery("o-1", body)).resolves.toMatchObject({ status: "cancelled" })
    expect(api.POST).toHaveBeenCalledWith("/api/delivery/orders/{id}/cancel", { params: { path: { id: "o-1" } }, body })
    const refusal = new ApiError(403, "Forbidden", "Esta acción necesita la autorización de un supervisor", { code: "authorization_required" })
    api.POST.mockRejectedValueOnce(refusal)
    await expect(cancelDelivery("o-1", { reason: "customer_left" })).rejects.toBe(refusal)
  })

  it("getClosedTodaySummary reads GET /api/delivery/closed-today", async () => {
    const summary = { deliveredCount: 12, cancelledCount: 1, failedCount: 2, averageDeliveryMinutes: 28 }
    api.GET.mockResolvedValue({ data: summary })
    await expect(getClosedTodaySummary()).resolves.toEqual(summary)
    expect(api.GET).toHaveBeenCalledWith("/api/delivery/closed-today")
  })

  it("updateCourier sends isActive alone (what the delivery operator may change)", async () => {
    api.PATCH.mockResolvedValue({ data: { ...courier, isActive: false } })
    await updateCourier("k-1", { isActive: false })
    expect(api.PATCH).toHaveBeenCalledWith("/api/delivery/couriers/{id}", { params: { path: { id: "k-1" } }, body: { isActive: false } })
  })
})

describe("listActiveDeliveries", () => {
  it("reads GET /api/delivery/active as the board rows", async () => {
    const rows = [{ delivery, amountDue: 19000, subtotal: 19000, tax: 0, isPaid: false }]
    api.GET.mockResolvedValue({ data: rows })
    await expect(listActiveDeliveries()).resolves.toEqual(rows)
    expect(api.GET).toHaveBeenCalledWith("/api/delivery/active")
  })

  it("maps a 403 to not-authorized", async () => {
    api.GET.mockRejectedValue(apiError(403, "Forbidden"))
    await expect(kindOf(listActiveDeliveries())).resolves.toBe("not-authorized")
  })
})

describe("deliveryErrorOf", () => {
  it("passes a DeliveryServiceError through and wraps anything else as unknown", () => {
    const own = new DeliveryServiceError({ kind: "rejected", message: "x" })
    expect(deliveryErrorOf(own)).toBe(own)
    const wrapped = deliveryErrorOf(new Error("network"))
    expect(wrapped.kind).toBe("unknown")
    expect(wrapped.message).toBe("network")
  })
})
