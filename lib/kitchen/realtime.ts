/**
 * lib/kitchen/realtime.ts
 *
 * Pure plumbing for the kitchen realtime stream (T7, odd/tasks/cargas-por-perfil.md
 * S1). Two problems the audit found, both solved here so they can be unit
 * tested without Supabase, React or the DOM:
 *
 * 1. One order read per event burst. A new 5-item order arrives as one `orders`
 *    INSERT plus five `order_items` INSERTs (one transaction, one realtime
 *    message per row). Reading the order per event cost six reads for the same
 *    order, and each consumer then read it again from its own handler.
 *    `createKitchenEventCoalescer` keeps one pending bucket per `orderId` for a
 *    short window, so a burst costs exactly ONE read and ONE batch.
 * 2. Echoes of the kitchen's own writes. Marking an item served writes
 *    `order_items` and gets the change straight back through the same
 *    channel; reading the order again is pure waste (and it raced the local
 *    patch). `createLocalChangeRegistry` is the WaiterView `localChangesRef`
 *    pattern in consumable form: mark before the write, consume once.
 *
 * No Supabase, no React: the service wires this to channels, the view applies
 * the batch to the store.
 */

/** Window that merges the events of one burst. Supabase delivers the rows of a
 * single transaction in the same message, so this only has to cover the
 * spread between them — it is not a debounce of real user work. */
export const KITCHEN_EVENT_COALESCE_MS = 150

/**
 * How long an "own write" mark stays valid. A mark is meant to hide exactly one
 * echo; if that echo never comes (the item was already served on another
 * terminal, the write was already reflected), the mark must not survive
 * forever, or it would swallow a later REAL change to the same item.
 */
export const LOCAL_CHANGE_TTL_MS = 5_000

export type KitchenEvent =
  /** An `orders` row reached the kitchen (status=kitchen INSERT). */
  | { type: "order"; orderId: string }
  /** An `order_items` row entered the kitchen and the kitchen did not know it. */
  | { type: "itemNew"; orderId: string; itemId: string }
  /** An `order_items` row the kitchen already knew entered the kitchen again. */
  | { type: "itemKnown"; orderId: string; itemId: string }
  /** An `order_items` row left the kitchen (served elsewhere). */
  | { type: "itemServed"; orderId: string; itemId: string }

/** What one read of one order produces, ready to apply to the queue. */
export interface KitchenItemBatch<TOrder> {
  orderId: string
  /** The single fresh order read, `order_items` included. */
  order: TOrder
  /** Items that entered the kitchen since the last batch and were unknown. */
  newItemIds: string[]
  /** Items that left the kitchen since the last batch. */
  servedItemIds: string[]
  /** An `orders` INSERT arrived in this burst: the order is a new one. */
  isNewOrder: boolean
}

export interface KitchenEventCoalescer<TOrder> {
  enqueue(event: KitchenEvent): void
  /** Read and deliver the pending burst of one order right now. */
  flush(orderId: string): Promise<void>
  /** Drop every pending burst without reading anything (unsubscribe). */
  dispose(): void
}

export interface KitchenEventCoalescerOptions<TOrder> {
  /** The one order read a burst costs. Resolves null when the order is gone. */
  loadOrder: (orderId: string) => Promise<TOrder | null>
  onBatch: (batch: KitchenItemBatch<TOrder>) => void
  onError?: (orderId: string, error: unknown) => void
  delayMs?: number
}

interface PendingBurst {
  newItemIds: string[]
  servedItemIds: string[]
  isNewOrder: boolean
  /** Per-order monotonic tag: a read whose burst has been superseded is stale. */
  sequence: number
  timer: ReturnType<typeof setTimeout> | null
}

export function createKitchenEventCoalescer<TOrder>(
  options: KitchenEventCoalescerOptions<TOrder>,
): KitchenEventCoalescer<TOrder> {
  const delayMs = options.delayMs ?? KITCHEN_EVENT_COALESCE_MS
  const pending = new Map<string, PendingBurst>()
  // Latest burst tag per order. Two bursts of the same order can have their
  // reads in flight at once; if the older one resolves last, delivering it would
  // overwrite the newer state with older data.
  const latestSequence = new Map<string, number>()
  // Events of a burst whose read lost that race, kept for the next delivery.
  const carried = new Map<string, PendingBurst>()
  let nextSequence = 0
  // After `dispose` the owner is gone: a stray event must not start a read that
  // nobody will consume.
  let disposed = false

  /** Fold a superseded burst's events into the burst that supersedes it. */
  const carry = (orderId: string, burst: PendingBurst): void => {
    const target = pending.get(orderId) ?? carried.get(orderId)
    if (!target) return void carried.set(orderId, burst)
    target.isNewOrder = target.isNewOrder || burst.isNewOrder
    const known = (itemId: string) => target.newItemIds.includes(itemId) || target.servedItemIds.includes(itemId)
    target.newItemIds.push(...burst.newItemIds.filter((itemId) => !known(itemId)))
    target.servedItemIds.push(...burst.servedItemIds.filter((itemId) => !known(itemId)))
  }

  const deliver = async (orderId: string, burst: PendingBurst): Promise<void> => {
    let order: TOrder | null = null
    try {
      order = await options.loadOrder(orderId)
    } catch (error) {
      // A failing read must never reject inside a realtime event handler.
      options.onError?.(orderId, error)
      return
    }
    if (disposed) return
    // A newer burst of this order already owns the state: this read is stale,
    // but its events are kept for the next delivery of that order.
    if (latestSequence.get(orderId) !== burst.sequence) {
      carry(orderId, burst)
      return
    }
    latestSequence.delete(orderId)
    if (order == null) return
    options.onBatch({
      orderId,
      order,
      newItemIds: burst.newItemIds,
      servedItemIds: burst.servedItemIds,
      isNewOrder: burst.isNewOrder,
    })
  }

  const enqueue = (event: KitchenEvent): void => {
    if (disposed) return
    // A carried burst is reused as the new bucket: same order, one lineage.
    const burst = pending.get(event.orderId) ?? carried.get(event.orderId) ?? {
      newItemIds: [],
      servedItemIds: [],
      isNewOrder: false,
      sequence: 0,
      timer: null,
    }
    carried.delete(event.orderId)
    burst.sequence = (nextSequence += 1)
    pending.set(event.orderId, burst)
    latestSequence.set(event.orderId, burst.sequence)

    if (event.type === "order") {
      burst.isNewOrder = true
    } else if (event.type === "itemNew") {
      if (!burst.newItemIds.includes(event.itemId)) burst.newItemIds.push(event.itemId)
    } else if (event.type === "itemServed") {
      if (!burst.servedItemIds.includes(event.itemId)) burst.servedItemIds.push(event.itemId)
    }

    // The window is armed by the first event of the burst and never re-armed:
    // a later event must not push the read further away.
    if (burst.timer !== null) return
    burst.timer = setTimeout(() => {
      burst.timer = null
      pending.delete(event.orderId)
      void deliver(event.orderId, burst)
    }, delayMs)
  }

  const flush = async (orderId: string): Promise<void> => {
    const burst = pending.get(orderId)
    if (!burst || disposed) return
    pending.delete(orderId)
    if (burst.timer !== null) clearTimeout(burst.timer)
    burst.timer = null
    await deliver(orderId, burst)
  }

  const dispose = (): void => {
    disposed = true
    for (const burst of pending.values()) {
      if (burst.timer !== null) clearTimeout(burst.timer)
      burst.timer = null
    }
    pending.clear()
    latestSequence.clear()
    carried.clear()
  }

  return { enqueue, flush, dispose }
}

/**
 * Consume-once registry of the changes this kitchen made itself, so their
 * realtime echo costs nothing. Mirrors `WaiterView`'s `localChangesRef`: mark
 * BEFORE the write (the echo can beat the awaited response) and `unmark` when
 * the write failed, so a failed write cannot swallow a later real change.
 *
 * A mark also expires after `ttlMs`: an echo that never arrives must not leave
 * a mark behind that would hide a real change to the same item days later.
 */
export interface LocalChangeRegistry {
  mark(itemIds: readonly string[]): void
  consume(itemId: string): boolean
  unmark(itemIds: readonly string[]): void
  size(): number
  dispose(): void
}

export interface LocalChangeRegistryOptions {
  /** Lifetime of a mark in ms. Default {@link LOCAL_CHANGE_TTL_MS}. */
  ttlMs?: number
  /** Clock, injectable for tests. Default `Date.now`. */
  now?: () => number
}

export function createLocalChangeRegistry(options: LocalChangeRegistryOptions = {}): LocalChangeRegistry {
  const ttlMs = options.ttlMs ?? LOCAL_CHANGE_TTL_MS
  const now = options.now ?? (() => Date.now())
  const expiresAt = new Map<string, number>()

  const isLive = (itemId: string): boolean => {
    const expiry = expiresAt.get(itemId)
    return expiry !== undefined && expiry > now()
  }

  const prune = (): void => {
    for (const [itemId, expiry] of expiresAt) {
      if (expiry <= now()) expiresAt.delete(itemId)
    }
  }

  return {
    mark(itemIds) {
      prune()
      const deadline = now() + ttlMs
      for (const itemId of itemIds) expiresAt.set(itemId, deadline)
    },
    consume(itemId) {
      const live = isLive(itemId)
      expiresAt.delete(itemId)
      return live
    },
    unmark(itemIds) {
      for (const itemId of itemIds) expiresAt.delete(itemId)
    },
    size() {
      prune()
      return expiresAt.size
    },
    dispose() {
      expiresAt.clear()
    },
  }
}