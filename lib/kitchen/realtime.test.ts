/**
 * T7 (S1) — kitchen realtime: every order/item event must cost at most ONE
 * order read, and the kitchen's own writes must cost none.
 *
 * RED target: `lib/kitchen/realtime.ts` does not exist yet.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  KITCHEN_EVENT_COALESCE_MS,
  LOCAL_CHANGE_TTL_MS,
  createKitchenEventCoalescer,
  createLocalChangeRegistry,
  type KitchenEvent,
} from "./realtime"

describe("createLocalChangeRegistry (echo filter)", () => {
  it("consumes a marked id exactly once", () => {
    const registry = createLocalChangeRegistry()

    registry.mark(["i-1"])

    expect(registry.consume("i-1")).toBe(true)
    // The echo already arrived: the next event for the same item is a real one.
    expect(registry.consume("i-1")).toBe(false)
  })

  it("never consumes an id it did not mark", () => {
    const registry = createLocalChangeRegistry()

    expect(registry.consume("i-9")).toBe(false)
  })

  it("keeps marks of different ids apart", () => {
    const registry = createLocalChangeRegistry()

    registry.mark(["i-1"])
    registry.mark(["i-2"])

    expect(registry.consume("i-1")).toBe(true)
    expect(registry.consume("i-2")).toBe(true)
    expect(registry.size()).toBe(0)
  })

  it("unmark drops a mark whose write never produced an event", () => {
    const registry = createLocalChangeRegistry()

    registry.mark(["i-1"])
    registry.unmark(["i-1"])

    expect(registry.consume("i-1")).toBe(false)
  })

  it("clears every mark on dispose", () => {
    const registry = createLocalChangeRegistry()

    registry.mark(["i-1"])
    registry.mark(["i-2"])
    registry.dispose()

    expect(registry.size()).toBe(0)
    expect(registry.consume("i-1")).toBe(false)
  })
})

describe("createKitchenEventCoalescer (one order read per orderId)", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function setup(order: unknown = { id: "o-1" }) {
    const loadOrder = vi.fn().mockImplementation(async (orderId: string) => ({ ...(order as object), id: orderId }))
    const onBatch = vi.fn()
    const onError = vi.fn()
    const coalescer = createKitchenEventCoalescer({ loadOrder, onBatch, onError, delayMs: 120 })
    return { coalescer, loadOrder, onBatch, onError }
  }

  it("turns a 5-item order insert into ONE order read and ONE batch", async () => {
    const { coalescer, loadOrder, onBatch } = setup()

    const events: KitchenEvent[] = [
      { type: "order", orderId: "o-1" },
      { type: "itemNew", orderId: "o-1", itemId: "i-1" },
      { type: "itemNew", orderId: "o-1", itemId: "i-2" },
      { type: "itemNew", orderId: "o-1", itemId: "i-3" },
      { type: "itemNew", orderId: "o-1", itemId: "i-4" },
      { type: "itemNew", orderId: "o-1", itemId: "i-5" },
    ]
    events.forEach((event) => coalescer.enqueue(event))

    expect(loadOrder).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(KITCHEN_EVENT_COALESCE_MS)

    expect(loadOrder).toHaveBeenCalledTimes(1)
    expect(loadOrder).toHaveBeenCalledWith("o-1")
    expect(onBatch).toHaveBeenCalledTimes(1)
    expect(onBatch).toHaveBeenCalledWith({
      orderId: "o-1",
      order: { id: "o-1" },
      newItemIds: ["i-1", "i-2", "i-3", "i-4", "i-5"],
      servedItemIds: [],
      isNewOrder: true,
    })
  })

  it("coalesces the item status changes of one order too", async () => {
    const { coalescer, loadOrder, onBatch } = setup()

    coalescer.enqueue({ type: "itemServed", orderId: "o-1", itemId: "i-1" })
    coalescer.enqueue({ type: "itemServed", orderId: "o-1", itemId: "i-2" })

    await vi.advanceTimersByTimeAsync(KITCHEN_EVENT_COALESCE_MS)

    expect(loadOrder).toHaveBeenCalledTimes(1)
    expect(onBatch).toHaveBeenCalledWith(
      expect.objectContaining({ newItemIds: [], servedItemIds: ["i-1", "i-2"], isNewOrder: false }),
    )
  })

  it("never mixes two orders in one batch", async () => {
    const { coalescer, loadOrder, onBatch } = setup()

    coalescer.enqueue({ type: "itemNew", orderId: "o-1", itemId: "i-1" })
    coalescer.enqueue({ type: "itemNew", orderId: "o-2", itemId: "i-2" })

    await vi.advanceTimersByTimeAsync(KITCHEN_EVENT_COALESCE_MS)

    expect(loadOrder).toHaveBeenCalledTimes(2)
    expect(onBatch).toHaveBeenCalledTimes(2)
    expect(onBatch.mock.calls.map(([batch]) => batch.orderId)).toEqual(["o-1", "o-2"])
    expect(onBatch.mock.calls.map(([batch]) => batch.newItemIds)).toEqual([["i-1"], ["i-2"]])
  })

  it("loads again for events that arrive in a later window", async () => {
    const { coalescer, loadOrder, onBatch } = setup()

    coalescer.enqueue({ type: "itemNew", orderId: "o-1", itemId: "i-1" })
    await vi.advanceTimersByTimeAsync(KITCHEN_EVENT_COALESCE_MS)
    coalescer.enqueue({ type: "itemNew", orderId: "o-1", itemId: "i-2" })
    await vi.advanceTimersByTimeAsync(KITCHEN_EVENT_COALESCE_MS)

    expect(loadOrder).toHaveBeenCalledTimes(2)
    expect(onBatch).toHaveBeenCalledTimes(2)
    expect(onBatch.mock.calls[1][0].newItemIds).toEqual(["i-2"])
  })

  it("dedupes repeated events for the same item", async () => {
    const { coalescer, onBatch } = setup()

    coalescer.enqueue({ type: "itemNew", orderId: "o-1", itemId: "i-1" })
    coalescer.enqueue({ type: "itemNew", orderId: "o-1", itemId: "i-1" })

    await vi.advanceTimersByTimeAsync(KITCHEN_EVENT_COALESCE_MS)

    expect(onBatch).toHaveBeenCalledWith(expect.objectContaining({ newItemIds: ["i-1"] }))
  })

  it("does not flush when the order read returns nothing", async () => {
    const loadOrder = vi.fn().mockResolvedValue(null)
    const onBatch = vi.fn()
    const coalescer = createKitchenEventCoalescer({ loadOrder, onBatch, delayMs: 120 })

    coalescer.enqueue({ type: "itemNew", orderId: "o-1", itemId: "i-1" })
    await vi.advanceTimersByTimeAsync(120)

    expect(loadOrder).toHaveBeenCalledTimes(1)
    expect(onBatch).not.toHaveBeenCalled()
    coalescer.dispose()
  })

  it("reports a failing read instead of throwing at the event site", async () => {
    const loadOrder = vi.fn().mockRejectedValue(new Error("offline"))
    const onBatch = vi.fn()
    const onError = vi.fn()
    const coalescer = createKitchenEventCoalescer({ loadOrder, onBatch, onError, delayMs: 120 })

    coalescer.enqueue({ type: "itemNew", orderId: "o-1", itemId: "i-1" })
    await vi.advanceTimersByTimeAsync(120)

    expect(onBatch).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith("o-1", expect.any(Error))
    coalescer.dispose()
  })

  it("flushes a pending order immediately on demand", async () => {
    const { coalescer, loadOrder, onBatch } = setup()

    coalescer.enqueue({ type: "itemNew", orderId: "o-1", itemId: "i-1" })
    await coalescer.flush("o-1")

    expect(loadOrder).toHaveBeenCalledTimes(1)
    expect(onBatch).toHaveBeenCalledTimes(1)

    // The window that was already pending must not read the order twice.
    await vi.advanceTimersByTimeAsync(KITCHEN_EVENT_COALESCE_MS)
    expect(loadOrder).toHaveBeenCalledTimes(1)
  })

  it("dispose drops pending batches without reading the order", async () => {
    const { coalescer, loadOrder, onBatch } = setup()

    coalescer.enqueue({ type: "itemNew", orderId: "o-1", itemId: "i-1" })
    coalescer.dispose()
    await vi.advanceTimersByTimeAsync(KITCHEN_EVENT_COALESCE_MS)

    expect(loadOrder).not.toHaveBeenCalled()
    expect(onBatch).not.toHaveBeenCalled()
  })

  it("ignores events that arrive after dispose", async () => {
    const { coalescer, loadOrder, onBatch } = setup()

    coalescer.dispose()
    coalescer.enqueue({ type: "itemNew", orderId: "o-1", itemId: "i-1" })
    await coalescer.flush("o-1")
    await vi.advanceTimersByTimeAsync(KITCHEN_EVENT_COALESCE_MS)

    expect(loadOrder).not.toHaveBeenCalled()
    expect(onBatch).not.toHaveBeenCalled()
  })
})
describe("A1 — a mark must not outlive the echo it was made for", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("expires a mark after its lifetime, so a real change is not swallowed", () => {
    vi.useFakeTimers()
    const registry = createLocalChangeRegistry()

    registry.mark(["i-1"])
    expect(registry.consume("i-1")).toBe(true)

    // The write that had no echo (the item was already served elsewhere): the
    // mark is still there. A real "served" change arriving now MUST be seen.
    registry.mark(["i-2"])
    vi.advanceTimersByTime(LOCAL_CHANGE_TTL_MS + 1)
    expect(registry.consume("i-2")).toBe(false)
  })

  it("keeps a mark alive while it is still young", () => {
    vi.useFakeTimers()
    const registry = createLocalChangeRegistry()

    registry.mark(["i-1"])
    vi.advanceTimersByTime(LOCAL_CHANGE_TTL_MS - 1)

    expect(registry.consume("i-1")).toBe(true)
  })

  it("forgets expired marks instead of accumulating them", () => {
    vi.useFakeTimers()
    const registry = createLocalChangeRegistry()

    registry.mark(["i-1"])
    registry.mark(["i-2"])
    vi.advanceTimersByTime(LOCAL_CHANGE_TTL_MS + 1)
    expect(registry.size()).toBe(0)

    registry.mark(["i-3"])
    expect(registry.size()).toBe(1)
  })

  it("honours an explicit lifetime and clock", () => {
    let now = 1_000
    const registry = createLocalChangeRegistry({ ttlMs: 50, now: () => now })

    registry.mark(["i-1"])
    now += 49
    expect(registry.consume("i-1")).toBe(true)

    registry.mark(["i-2"])
    now += 50
    // Exactly at the deadline the mark is already expired.
    expect(registry.consume("i-2")).toBe(false)
  })
})

describe("A2 — a late read must not overwrite a newer state", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((res) => {
      resolve = res
    })
    return { promise, resolve }
  }

  it("keeps the A2 guarantee and does not lose the superseded burst's events", async () => {
    type Read = { id: string; version: number }
    const read = (v: number): Read => ({ id: "o-1", version: v })
    const first = deferred<Read>(), second = deferred<Read>()
    const loadOrder = vi
      .fn<() => Promise<Read>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockImplementationOnce(async () => read(3))
    const onBatch = vi.fn()
    const coalescer = createKitchenEventCoalescer({ loadOrder, onBatch, delayMs: 120 })

    // Burst A: a new order (order INSERT + its first item). Burst B starts
    // before A's read is back, and B's read resolves first.
    coalescer.enqueue({ type: "order", orderId: "o-1" })
    coalescer.enqueue({ type: "itemNew", orderId: "o-1", itemId: "i-1" })
    await vi.advanceTimersByTimeAsync(120)
    coalescer.enqueue({ type: "itemKnown", orderId: "o-1", itemId: "i-9" })
    await vi.advanceTimersByTimeAsync(120)
    second.resolve(read(2))
    await vi.advanceTimersByTimeAsync(1)
    expect(onBatch.mock.calls[0][0].order).toEqual(read(2))

    // A's read lands late: it must not overwrite B (still one batch delivered).
    first.resolve(read(1))
    await vi.advanceTimersByTimeAsync(1)

    // R3: A's events were not dropped with its read. The next burst of this
    // order still carries "this is a new order" and the item that arrived.
    coalescer.enqueue({ type: "itemServed", orderId: "o-1", itemId: "i-8" })
    await vi.advanceTimersByTimeAsync(120)
    await vi.advanceTimersByTimeAsync(1)
    expect(onBatch).toHaveBeenCalledTimes(2)
    expect(onBatch.mock.calls[1][0]).toMatchObject({ order: read(3), isNewOrder: true, newItemIds: ["i-1"], servedItemIds: ["i-8"] })
    coalescer.dispose()
  })

  it("still delivers an order whose burst has no successor", async () => {
    const slow = deferred<{ id: string }>()
    const loadOrder = vi.fn().mockImplementation(() => slow.promise)
    const onBatch = vi.fn()
    const coalescer = createKitchenEventCoalescer({ loadOrder, onBatch, delayMs: 120 })

    coalescer.enqueue({ type: "itemNew", orderId: "o-1", itemId: "i-1" })
    await vi.advanceTimersByTimeAsync(120)
    slow.resolve({ id: "o-1" })
    await vi.advanceTimersByTimeAsync(1)

    expect(onBatch).toHaveBeenCalledTimes(1)
    coalescer.dispose()
  })

  it("keeps two orders independent when one of them has a late read", async () => {
    const slow = deferred<{ id: string }>()
    const loadOrder = vi
      .fn()
      .mockImplementationOnce(() => slow.promise)
      .mockImplementation(async (orderId: string) => ({ id: orderId }))
    const onBatch = vi.fn()
    const coalescer = createKitchenEventCoalescer({ loadOrder, onBatch, delayMs: 120 })

    coalescer.enqueue({ type: "itemNew", orderId: "o-1", itemId: "i-1" })
    coalescer.enqueue({ type: "itemNew", orderId: "o-2", itemId: "i-2" })
    await vi.advanceTimersByTimeAsync(120)

    expect(onBatch.mock.calls.map(([batch]) => batch.orderId)).toEqual(["o-2"])

    slow.resolve({ id: "o-1" })
    await vi.advanceTimersByTimeAsync(1)
    expect(onBatch.mock.calls.map(([batch]) => batch.orderId)).toEqual(["o-2", "o-1"])
    coalescer.dispose()
  })
})
