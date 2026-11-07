import { io, type Socket } from "socket.io-client"
import { toast } from "@/components/ui/use-toast"
import {
  createKitchenEventCoalescer,
  createLocalChangeRegistry,
  type KitchenItemBatch,
} from "@/lib/kitchen/realtime"
import { log } from "@/lib/log"
import { queryClient } from "@/lib/queryClient"
import type { Order } from "@/types"
import { api, onSessionRefreshed } from "./client"
import { getById, toOrder } from "./orders"

/**
 * Live updates from the API (T8b, S3): ONE socket.io connection to the
 * `/realtime` namespace, authenticated by the session cookie at the handshake.
 * It replaces the Supabase `postgres_changes` channels with the same
 * subscription contracts, so `lib/realtime/order-merge.ts` and `table-merge.ts`
 * consume the payloads unchanged:
 *
 * - `pos_changes` carries the Supabase payload shape. The API enriches it:
 *   `orders` rows bring `order_items` (no per-client item read any more) and
 *   `tables` rows bring `waiter_name`.
 * - `resync` (the API lost its database listener) and every reconnect
 *   invalidate the order, table, zone and delivery queries: a change made while the
 *   socket was down is refetched instead of lost.
 * - A silent auth refresh reconnects the socket, so the next handshake carries
 *   the new access cookie.
 *
 * Same origin: in development `next.config.mjs` proxies `/socket.io/` to the
 * API; in production the reverse proxy routes it (keeping the trailing slash).
 */

/** Supabase-shaped change event, as emitted by the API gateway. */
export interface ChangeEvent {
  schema: "public"
  table: "orders" | "order_items" | "tables" | "zones" | "order_deliveries"
  commit_timestamp: string
  eventType: "INSERT" | "UPDATE" | "DELETE"
  new: Record<string, any>
  old: Record<string, any>
  errors: null
}

export const REALTIME_NAMESPACE = "/realtime"
export const CHANGE_EVENT = "pos_changes"
export const RESYNC_EVENT = "resync"

/** What a missed notification can leave stale. `['orders']` also covers the per-screen order keys. */
export const RESYNC_QUERY_KEYS = [["orders"], ["orders", "kitchen"], ["tables"], ["zones"], ["active-deliveries"]] as const

type ChangeCallback = (payload: ChangeEvent) => void
type ConnectionStatusCallback = (status: boolean) => void
/** `orders` DELETE event: the row is gone, the payload carries the id. */
type KitchenOrderDeleteCallback = (payload: ChangeEvent) => void
/** One read of one order plus everything that happened to it since the last batch. */
type KitchenItemBatchCallback = (batch: KitchenItemBatch<Order>) => void

const tableListeners = new Set<ChangeCallback>()
/** Floor plan zones (T6): an admin's zone edit reaches every open map. */
const zoneListeners = new Set<ChangeCallback>()
const orderListeners = new Set<ChangeCallback>()
/** Kitchen subscriptions see orders and order_items events. */
const kitchenListeners = new Set<ChangeCallback>()
/** Delivery board subscriptions see order_deliveries events and delivery orders events. */
const deliveryListeners = new Set<ChangeCallback>()
const statusListeners = new Set<ConnectionStatusCallback>()

/** Item ids whose next realtime event is this kitchen's own write. */
const kitchenLocalChanges = createLocalChangeRegistry()

let socket: Socket | null = null
let stopRefreshListener: (() => void) | null = null
let hasConnected = false
/** One session probe per failed handshake, so an expired cookie gets refreshed once. */
let probingSession = false
let retryTimer: ReturnType<typeof setTimeout> | null = null

/** Wait before retrying a refused handshake whose session turned out valid. */
export const REFUSED_HANDSHAKE_RETRY_MS = 2_000

const subscriberCount = () =>
  tableListeners.size + zoneListeners.size + orderListeners.size + kitchenListeners.size + deliveryListeners.size

/** `orders.order_type` is on `new` for INSERT/UPDATE and on `old` for DELETE. */
const isDeliveryOrder = (event: ChangeEvent): boolean =>
  (event.new?.order_type ?? event.old?.order_type) === "delivery"

function resync(): void {
  for (const queryKey of RESYNC_QUERY_KEYS) {
    void queryClient.invalidateQueries({ queryKey: [...queryKey] }).catch(() => undefined)
  }
}

function setConnected(connected: boolean): void {
  realtimeService.isConnected = connected
  for (const listener of [...statusListeners]) listener(connected)
}

function dispatch(event: ChangeEvent): void {
  const targets =
    event.table === "tables"
      ? [tableListeners]
      : event.table === "zones"
        ? [zoneListeners]
        : event.table === "orders"
          ? isDeliveryOrder(event)
            ? [orderListeners, kitchenListeners, deliveryListeners]
            : [orderListeners, kitchenListeners]
          : event.table === "order_items"
            ? [kitchenListeners]
            : event.table === "order_deliveries"
              ? [deliveryListeners]
              : []
  // The payload is shared by reference across every consumer: read it, never mutate it.
  for (const listeners of targets) {
    for (const listener of [...listeners]) {
      try {
        listener(event)
      } catch (error) {
        log.error("Error al aplicar un cambio en tiempo real:", { table: event.table, error: String(error) })
      }
    }
  }
}

function ensureSocket(): Socket {
  if (socket) return socket
  hasConnected = false
  const next = io(REALTIME_NAMESPACE, {
    path: "/socket.io/",
    withCredentials: true,
    // The API's engine.io only answers `/socket.io/`; next.config.mjs keeps
    // that slash through the dev proxy (skipTrailingSlashRedirect + rewrite).
    addTrailingSlash: true,
  })
  next.on("connect", () => {
    probingSession = false
    // The first connect starts from a fresh read; a later one may have missed changes.
    if (hasConnected) resync()
    hasConnected = true
    setConnected(true)
  })
  next.on("disconnect", () => setConnected(false))
  next.on("connect_error", (error: Error) => {
    setConnected(false)
    // The gateway refuses a handshake without a valid access cookie and the
    // client does not retry that on its own: one authenticated request runs
    // the API client's silent refresh, whose event reconnects this socket.
    if (error?.message === "unauthorized" && !probingSession) {
      probingSession = true
      // A valid session (or one the client just refreshed) means the refusal
      // was transient: retry once, unless something reconnected meanwhile.
      void api.GET("/api/auth/me").then(
        () => {
          if (retryTimer) clearTimeout(retryTimer)
          retryTimer = setTimeout(() => {
            retryTimer = null
            if (socket && !socket.connected) socket.connect()
          }, REFUSED_HANDSHAKE_RETRY_MS)
        },
        () => undefined,
      )
    }
  })
  next.on(CHANGE_EVENT, dispatch)
  next.on(RESYNC_EVENT, resync)
  stopRefreshListener = onSessionRefreshed(() => {
    if (!socket) return
    socket.disconnect()
    socket.connect()
  })
  socket = next
  return next
}

function closeSocketIfUnused(): void {
  if (subscriberCount() > 0 || !socket) return
  stopRefreshListener?.()
  stopRefreshListener = null
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  probingSession = false
  socket.removeAllListeners()
  socket.disconnect()
  socket = null
  hasConnected = false
  setConnected(false)
}

function listen(listeners: Set<ChangeCallback>, callback: ChangeCallback): () => void {
  listeners.add(callback)
  ensureSocket()
  return () => {
    listeners.delete(callback)
    closeSocketIfUnused()
  }
}

export const realtimeService = {
  /** Item ids per order the kitchen already shows. */
  knownItems: {} as Record<string, Set<string>>,

  isConnected: false,

  /** `tables` changes, `waiter_name` included. The role is kept for call-site compatibility. */
  subscribeToTables: (callback: ChangeCallback, _role = "waiter") => listen(tableListeners, callback),

  /** `zones` changes (name, aspect, order, wall labels, active). */
  subscribeToZones: (callback: ChangeCallback) => listen(zoneListeners, callback),

  /**
   * Socket connection state (T24 "En vivo" pill): called now with the current
   * state, then on every change. It does not open or keep the socket by itself;
   * the screen's data subscriptions do.
   */
  subscribeToConnectionStatus: (callback: ConnectionStatusCallback) => {
    statusListeners.add(callback)
    callback(realtimeService.isConnected)
    return () => {
      statusListeners.delete(callback)
    }
  },

  /** `orders` changes; INSERT and UPDATE rows carry `order_items`. */
  subscribeToOrders: (callback: ChangeCallback) => listen(orderListeners, callback),

  /**
   * Delivery board stream (T11): `order_deliveries` changes (full snake_case
   * rows, merged by `lib/delivery/realtime.ts`) and `orders` changes of
   * delivery orders only; table orders never reach the board.
   */
  subscribeToDeliveries: (callback: ChangeCallback) => listen(deliveryListeners, callback),

  /**
   * Kitchen stream (T7 contract, unchanged): every order/item event is queued
   * per order, the coalescer reads each order ONCE per burst and hands the
   * view a `KitchenItemBatch`; echoes of the kitchen's own writes cost nothing.
   */
  subscribeToKitchen: (
    orderDeleteCallback: KitchenOrderDeleteCallback,
    itemBatchCallback: KitchenItemBatchCallback,
    connectionStatusCallback: ConnectionStatusCallback,
  ) => {
    realtimeService.knownItems = {}
    kitchenLocalChanges.dispose()

    const markKnownItem = (orderId: string, itemId: string): boolean => {
      // The item is (back) in the kitchen, so a pending "own write" mark for it
      // describes a change that is no longer pending.
      kitchenLocalChanges.unmark([itemId])
      const known = realtimeService.knownItems[orderId]
      if (known?.has(itemId)) return false
      if (!known) realtimeService.knownItems[orderId] = new Set()
      realtimeService.knownItems[orderId].add(itemId)
      return true
    }

    const coalescer = createKitchenEventCoalescer<Order>({
      loadOrder: async (orderId) => {
        try {
          return toOrder(await getById(orderId))
        } catch (error) {
          log.error("Error al leer la orden de cocina:", { orderId, error: String(error) })
          toast({
            title: "Error",
            description: "No se pudo cargar los detalles de la nueva orden. Intente nuevamente.",
            variant: "destructive",
          })
          return null
        }
      },
      onBatch: (batch) => {
        const kitchenItems = batch.order.items.filter((item) => item.status === "kitchen")
        kitchenItems.forEach((item) => markKnownItem(batch.orderId, item.id))
        if (kitchenItems.length === 0) delete realtimeService.knownItems[batch.orderId]
        itemBatchCallback(batch)
      },
    })

    const onChange: ChangeCallback = (payload) => {
      if (payload.table === "orders") {
        if (payload.eventType === "INSERT" && payload.new?.status === "kitchen" && payload.new.id) {
          // Its items arrive as their own events in the same burst: one read.
          coalescer.enqueue({ type: "order", orderId: payload.new.id })
        } else if (payload.eventType === "DELETE" && payload.old?.id) {
          delete realtimeService.knownItems[payload.old.id]
          orderDeleteCallback(payload)
        } else if (payload.eventType === "UPDATE" && payload.new?.status === "cancelled" && payload.new.id) {
          // F3: a cancelled order is never deleted, but it leaves the board like one.
          delete realtimeService.knownItems[payload.new.id]
          orderDeleteCallback({ ...payload, old: { id: payload.new.id } })
        }
        return
      }

      const orderId = payload.new?.order_id
      const itemId = payload.new?.id
      if (!orderId || !itemId) return

      if (payload.eventType === "INSERT") {
        if (payload.new.status !== "kitchen") return
        coalescer.enqueue({ type: markKnownItem(orderId, itemId) ? "itemNew" : "itemKnown", orderId, itemId })
      } else if (payload.eventType === "UPDATE") {
        if (payload.old?.status === "kitchen" && payload.new.status !== "kitchen") {
          // This kitchen served it: the local patch already applied it.
          if (kitchenLocalChanges.consume(itemId)) return
          realtimeService.unregisterItem(orderId, itemId)
          coalescer.enqueue({ type: "itemServed", orderId, itemId })
        } else if (payload.new.status === "kitchen") {
          const isNewItem = markKnownItem(orderId, itemId)
          coalescer.enqueue({ type: isNewItem ? "itemNew" : "itemKnown", orderId, itemId })
        }
      }
    }

    statusListeners.add(connectionStatusCallback)
    const stop = listen(kitchenListeners, onChange)
    if (socket?.connected) connectionStatusCallback(true)

    return () => {
      // Pending bursts are dropped: whoever subscribes again refetches the queue.
      coalescer.dispose()
      statusListeners.delete(connectionStatusCallback)
      stop()
      realtimeService.knownItems = {}
      kitchenLocalChanges.dispose()
    }
  },

  /** Debug view of the live subscriptions. */
  getChannelsStatus: () => {
    const channels = [
      ...(tableListeners.size ? ["tables"] : []),
      ...(zoneListeners.size ? ["zones"] : []),
      ...(orderListeners.size ? ["orders"] : []),
      ...(kitchenListeners.size ? ["kitchen"] : []),
      ...(deliveryListeners.size ? ["deliveries"] : []),
    ]
    return {
      channels: channels.map((id) => ({ id, active: realtimeService.isConnected })),
      totalChannels: channels.length,
      activeChannels: realtimeService.isConnected ? channels.length : 0,
      isConnected: realtimeService.isConnected,
    }
  },

  isNewItem: (orderId: string, itemId: string): boolean => !realtimeService.knownItems[orderId]?.has(itemId),

  /**
   * Mark items whose next realtime event is THIS kitchen's write (serving).
   * Call BEFORE the write: the echo can beat the response.
   */
  markLocalItemChanges: (itemIds: readonly string[]): void => {
    kitchenLocalChanges.mark(itemIds)
  },

  /** The write failed and no echo will come: do not swallow a later real change. */
  unmarkLocalItemChanges: (itemIds: readonly string[]): void => {
    kitchenLocalChanges.unmark(itemIds)
  },

  registerItem: (orderId: string, itemId: string): void => {
    realtimeService.registerItems(orderId, [itemId])
  },

  registerItems: (orderId: string, itemIds: readonly string[]): void => {
    if (!realtimeService.knownItems[orderId]) realtimeService.knownItems[orderId] = new Set()
    itemIds.forEach((id) => realtimeService.knownItems[orderId].add(id))
  },

  unregisterItem: (orderId: string, itemId: string): void => {
    realtimeService.knownItems[orderId]?.delete(itemId)
  },

  unregisterOrder: (orderId: string): void => {
    delete realtimeService.knownItems[orderId]
  },

  /** Drop every subscription and close the socket. */
  unsubscribeAll: () => {
    tableListeners.clear()
    zoneListeners.clear()
    orderListeners.clear()
    kitchenListeners.clear()
    deliveryListeners.clear()
    statusListeners.clear()
    closeSocketIfUnused()
    realtimeService.knownItems = {}
    kitchenLocalChanges.dispose()
  },
}
