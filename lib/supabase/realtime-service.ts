import { supabase } from "./client"
import {
  type RealtimeChannel,
  type RealtimePostgresChangesPayload,
  REALTIME_SUBSCRIBE_STATES,
} from "@supabase/supabase-js"
import { orderService } from "./service"
import {
  createKitchenEventCoalescer,
  createLocalChangeRegistry,
  type KitchenItemBatch,
} from "@/lib/kitchen/realtime"
import type { DbOrderRow } from "@/lib/kitchen/order"
import {toast} from "@/components/ui/use-toast";
import {CartItem, CommandPayload, PrintableInvoice} from "@/types";
import { log } from "@/lib/log"

// Tipos para las funciones de callback
type BillPayload = {
  invoiceNumber: string;
  invoice: any;
  displayItems: any[];
};
type GenericPayload = Record<string, any>;
type PosEventCallback<T extends GenericPayload> = (payload: T) => void;
type TableCallback = (payload: RealtimePostgresChangesPayload<any>) => void
type OrderCallback = (payload: RealtimePostgresChangesPayload<any>, isNewOrder?: boolean) => void
type ConnectionStatusCallback = (status: boolean) => void

// --- Kitchen-only contracts (T7). `subscribeToOrders` / `subscribeToTables` /
// the broadcast helpers keep the shared contract the other views rely on.
// A DELETE of an `orders` row needs no read at all, and every item change of
// one burst arrives as ONE batch built from ONE order read.
/** `orders` DELETE event: the row is gone, the payload carries the id. */
type KitchenOrderDeleteCallback = (payload: RealtimePostgresChangesPayload<any>) => void
/** One read of one order plus everything that happened to it since the last batch. */
type KitchenItemBatchCallback = (batch: KitchenItemBatch<DbOrderRow>) => void

/** Item ids whose next realtime event is this kitchen's own write. */
const kitchenLocalChanges = createLocalChangeRegistry()

const CHANNEL_KEY_POS = "room_pos"

// Broadcast listener registry: channelKey -> eventName -> Set of handlers.
// Allows per-handler unsubscribe without tearing down the whole channel.
const broadcastListenerRegistry = new Map<string, Map<string, Set<Function>>>()

// Tables channel registry: storageKey -> { channel, callbacks Set }
// Allows multiple subscribers (WaiterView + TableGrid) to share one channel
// while each receiving events independently via their own callback.
type TablesChannelEntry = {
  channel: RealtimeChannel
  callbacks: Set<TableCallback>
}
const tablesChannels = new Map<string, TablesChannelEntry>()

// Orders channel registry: topic -> { channel, callbacks Set }.
// Mirrors tablesChannels above so WaiterView + CashierView + AdminView share
// one "orders-changes" channel instead of opening one each (D7).
type OrdersChannelEntry = {
  channel: RealtimeChannel
  callbacks: Set<OrderCallback>
}
const ordersChannels = new Map<string, OrdersChannelEntry>()

// Stable channel-name helper.  Each role-view (waiter / kitchen / cashier / admin)
// gets ONE persistent channel named `${topic}-${role}`.  The role suffix prevents
// cross-role event leakage.
const roleChannelName = (topic: string, role: string) => `${topic}-${role}`

// Module-private. Acquires (or creates) a broadcast channel WITHOUT registering
// any listener and WITHOUT touching broadcastListenerRegistry (D8). Used by
// sendFactura/sendCommand, which only need a reference to send on, and by
// subscribeToPosEvents, which performs its own registry insert and `.on()`
// binding on top of the channel this returns.
const getBroadcastChannel = (channelKey: string): RealtimeChannel => {
  if (!realtimeService.channels[channelKey]) {
    const channel = supabase.channel(channelKey)

    channel.subscribe(() => {
      realtimeService.isConnected = true
    })

    realtimeService.channels[channelKey] = channel
  }

  return realtimeService.channels[channelKey]
}

// Servicio para manejar suscripciones en tiempo real
export const realtimeService = {
  // Canales activos
  channels: {} as Record<string, RealtimeChannel>,

  // Registro de items conocidos por orden
  knownItems: {} as Record<string, Set<string>>,

  // Estado de la conexión
  isConnected: false,

  // Suscribirse a cambios en las mesas
  subscribeToTables: (callback: TableCallback, role = "waiter") => {
    const storageKey = `tables-${role}`
    let entry = tablesChannels.get(storageKey)
    if (!entry) {
      const channel = supabase
        .channel(roleChannelName("tables", role))
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "tables" },
          (payload) => {
            entry?.callbacks.forEach((cb) => cb(payload))
          },
        )
        .subscribe()
      entry = { channel, callbacks: new Set() }
      tablesChannels.set(storageKey, entry)
      realtimeService.isConnected = true
    }
    entry.callbacks.add(callback)
    return () => {
      const e = tablesChannels.get(storageKey)
      if (!e) return
      e.callbacks.delete(callback)
      if (e.callbacks.size === 0) {
        e.channel.unsubscribe()
        tablesChannels.delete(storageKey)
      }
    }
  },

  subscribeToPosEvents: <T extends GenericPayload>(channelKey: string, eventName: string, callback: PosEventCallback<T>) => {

    const channel = getBroadcastChannel(channelKey)

    // Register handler in our registry so it can be removed individually.
    if (!broadcastListenerRegistry.has(channelKey)) {
      broadcastListenerRegistry.set(channelKey, new Map())
    }
    const eventMap = broadcastListenerRegistry.get(channelKey)!
    if (!eventMap.has(eventName)) {
      eventMap.set(eventName, new Set())
    }
    eventMap.get(eventName)!.add(callback)

    // Attach the broadcast listener to the channel. This can run after
    // getBroadcastChannel() above has already called channel.subscribe() for a
    // pre-existing channel (D8 confirm-at-apply). Verified against the
    // installed @supabase/realtime-js@2.116.0 source
    // (RealtimeChannel.js `on()`): the "cannot add callbacks after subscribe()"
    // guard checks `type === PRESENCE || type === POSTGRES_CHANGES` only —
    // "broadcast" is exempt, and `_on()` registers the handler directly on the
    // channel's live message dispatcher, not into the one-shot join payload
    // that postgres_changes bindings need. So binding here, after subscribe(),
    // does bind correctly for broadcast events.
    channel.on("broadcast", { event: eventName}, ({payload}) => {
      callback(payload as T)
    })

    // Return a per-handler unsubscribe — removes only this handler,
    // does NOT tear down the channel if other handlers are registered.
    return () => {
      const evMap = broadcastListenerRegistry.get(channelKey)
      if (!evMap) return
      const handlerSet = evMap.get(eventName)
      if (handlerSet) {
        handlerSet.delete(callback)
        if (handlerSet.size === 0) {
          evMap.delete(eventName)
        }
      }
      // Note: we do NOT call supabase.removeChannel here because other
      // handlers on the same channel (different event names) may still be active.
      // The channel will be cleaned up when the last handler is removed or
      // when unsubscribeAll() is explicitly called.
    }
  },

  // enviar factura a un canal de realtime
  sendFactura: (invoiceNumber: string, invoice: PrintableInvoice, displayItems: CartItem[]) => {
    // enviar factura por broadcast
    const channelKey = "room_bills"
    const channel = getBroadcastChannel(channelKey)
    const payload = {
      invoiceNumber,
      invoice,
      displayItems,
    }

    channel.send({
      type: "broadcast",
      event: "new_invoice",
      payload,
    }).catch((error) => {
      toast({
        title: "Error",
        description: "No se pudo enviar la factura a través de la red realtime. Intente nuevamente.",
        variant: "destructive",
      })
    })
  },

  sendCommand: (command: CommandPayload) => {
      // enviar factura por broadcast
      const channelKey = "room_commands"
      const channel = getBroadcastChannel(channelKey)

      channel.send({
        type: "broadcast",
        event: "new_command",
        payload: {
          ...command,
        },
      }).catch((error) => {
        toast({
          title: "Error",
          description: "No se pudo enviar la factura a través de la red realtime. Intente nuevamente.",
          variant: "destructive",
        })
      })
  },

  // Suscribirse a cambios en las órdenes
  subscribeToOrders: (callback: OrderCallback) => {
    // One shared "orders-changes" channel for every caller (D7), mirroring
    // subscribeToTables above: a Map keyed by topic, callbacks in a Set, the
    // channel created only for the first caller and torn down only for the last.
    const topicKey = "orders-changes"
    let entry = ordersChannels.get(topicKey)
    if (!entry) {
      const channel = supabase
        .channel(topicKey)
        .on(
          "postgres_changes",
          {
            event: "*", // Escuchar todos los eventos (INSERT, UPDATE, DELETE)
            schema: "public",
            table: "orders",
          },
          async (payload) => {

            // Si es un evento INSERT o UPDATE, necesitamos obtener los items de la orden
            if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
              try {
                // D7: fetch order_items exactly once per event, before fan-out,
                // so N subscribed callbacks share one round trip instead of one
                // SELECT per caller.
                const { data: orderItems, error } = await supabase
                  .from("order_items")
                  .select("*")
                  .eq("order_id", payload.new.id)

                if (error) {
                  // D7: this used to `return` here, silently dropping the event
                  // for the single caller that requested it. Under a shared
                  // channel that would drop it for every caller instead. Log
                  // and still fan out below, leaving `order_items` undefined —
                  // never `[]`, which would render a paid order as having no
                  // items. Consumers MUST treat `order_items === undefined` as
                  // "unknown, do not overwrite the current items", never as
                  // "the order has no items".
                  log.error("Error al obtener los items de la orden", {
                    error: String(error),
                    orderId: payload.new.id,
                  })
                } else {
                  // Añadir los items a la orden
                  payload.new.order_items = orderItems || []
                }
              } catch (error) {
                toast({
                  title: "Error",
                  description: "No se pudo procesar el cambio de orden. Intente nuevamente.",
                  variant: "destructive",
                })
              }
            }

            // D7 read-only contract: `payload` is the SAME object reference
            // fanned out to every callback in `entry.callbacks`. Consumers
            // MUST NOT mutate `payload.new`/`payload.old`/`order_items` —
            // derive new local state instead.
            entry?.callbacks.forEach((cb) => cb(payload))
          },
        )
        .subscribe()
      entry = { channel, callbacks: new Set() }
      ordersChannels.set(topicKey, entry)
      realtimeService.isConnected = true
    }
    entry.callbacks.add(callback)

    // Devolver función para cancelar la suscripción
    return () => {
      const e = ordersChannels.get(topicKey)
      if (!e) return
      e.callbacks.delete(callback)
      if (e.callbacks.size === 0) {
        supabase.removeChannel(e.channel)
        ordersChannels.delete(topicKey)
      }
    }
  },

  // Suscribirse a cambios en la cocina (órdenes y productos).
  //
  // T7 (odd/tasks/cargas-por-perfil.md S1): this subscription is now the ONLY
  // place an order read happens per kitchen event, and a burst of events costs
  // one read. What it used to do per event:
  //   - read the order here (`orderService.getById`), then
  //   - hand a payload the view re-read the same order from anyway, so a new
  //     5-item order cost 6 reads here plus 5 more in `KitchenView`, and
  //     serving an item cost 2 more reads for a change the kitchen itself
  //     made (the optimistic local patch already covers it).
  // What it does now: every order/item event is enqueued per `orderId`, the
  // coalescer reads each order ONCE per burst and hands the view a
  // `KitchenItemBatch` built from that single read. Echoes of the kitchen's own
  // writes are consumed by `kitchenLocalChanges` before they can cost a read.
  //
  // Only the kitchen channels changed: `subscribeToOrders`, `subscribeToTables`
  // and the broadcast helpers above keep the contract the other views rely on.
  subscribeToKitchen: (
    orderDeleteCallback: KitchenOrderDeleteCallback,
    itemBatchCallback: KitchenItemBatchCallback,
    connectionStatusCallback: ConnectionStatusCallback,
  ) => {
    // Inicializar el registro de items conocidos
    realtimeService.knownItems = {}
    kitchenLocalChanges.dispose()

    const markKnownItem = (orderId: string, itemId: string): boolean => {
      // The item is (back) in the kitchen, so any pending "own write" mark for
      // it describes a change that is no longer pending: forget it, otherwise a
      // real change to this item would be read as an echo of ours.
      kitchenLocalChanges.unmark([itemId])
      const known = realtimeService.knownItems[orderId]
      if (known?.has(itemId)) return false
      if (!realtimeService.knownItems[orderId]) {
        realtimeService.knownItems[orderId] = new Set()
      }
      realtimeService.knownItems[orderId].add(itemId)
      return true
    }

    const forgetOrderItems = (orderId: string) => {
      delete realtimeService.knownItems[orderId]
    }

    // One order read per burst. A failing read reports once per burst (it used
    // to toast once per event) and never rejects inside the event handler.
    const coalescer = createKitchenEventCoalescer<DbOrderRow>({
      loadOrder: async (orderId) => {
        try {
          return ((await orderService.getById(orderId)) as DbOrderRow | null) ?? null
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
        const kitchenItems = batch.order.order_items?.filter((item) => item.status === "kitchen") ?? []
        kitchenItems.forEach((item) => markKnownItem(batch.orderId, item.id))
        if (kitchenItems.length === 0) forgetOrderItems(batch.orderId)
        itemBatchCallback(batch)
      },
    })

    // Activar el canal de tiempo real para verificar la conexión
    const statusChannel = supabase.channel("public:kitchen-status").subscribe((status) => {
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        log.info("Suscripción a cocina activada")
        connectionStatusCallback(true)
        realtimeService.isConnected = true
      } else {
        log.info("Estado de suscripción:", { status })
        // En el branch else ya sabemos que NO está SUBSCRIBED.
        connectionStatusCallback(false)
        realtimeService.isConnected = false
      }
    })

    // Suscribirse a inserciones en la tabla orders con filtro para estado "kitchen"
    const ordersChannel = supabase
      .channel("kitchen-orders-channel")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "orders",
          filter: "status=eq.kitchen",
        },
        (payload) => {
          const orderId = payload.new?.id
          if (!orderId) return
          // The items of this order arrive as their own events; both land in
          // the same burst, so the pair costs one read.
          coalescer.enqueue({ type: "order", orderId })
        },
      )
      .subscribe()

    // Suscribirse a inserciones de nuevos items en estado "kitchen"
    const newItemsChannel = supabase
      .channel("kitchen-new-items-channel")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "order_items",
          filter: "status=eq.kitchen",
        },
        (payload) => {
          const orderId = payload.new?.order_id
          const itemId = payload.new?.id
          if (!orderId || !itemId) return
          coalescer.enqueue({
            type: markKnownItem(orderId, itemId) ? "itemNew" : "itemKnown",
            orderId,
            itemId,
          })
        },
      )
      .subscribe()

    // Suscribirse a actualizaciones de items (cambios de estado)
    const itemUpdatesChannel = supabase
      .channel("kitchen-item-updates-channel")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "order_items",
        },
        (payload) => {
          const orderId = payload.new?.order_id
          const itemId = payload.new?.id
          if (!orderId || !itemId) return

          // Si el estado cambió de "kitchen" a otro estado
          if (payload.old?.status === "kitchen" && payload.new.status !== "kitchen") {
            // Un item que esta misma cocina acaba de servir vuelve por el
            // mismo canal: el parche local ya lo aplicó, así que ni una
            // lectura ni un callback (WaiterView `localChangesRef` pattern).
            if (kitchenLocalChanges.consume(itemId)) return
            realtimeService.unregisterItem(orderId, itemId)
            coalescer.enqueue({ type: "itemServed", orderId, itemId })
          }
          // Si el estado cambió a "kitchen"
          else if (payload.new.status === "kitchen") {
            const isNewItem = markKnownItem(orderId, itemId)
            log.info(`Item ${itemId} actualizado a estado kitchen, es nuevo: ${isNewItem}`)
            coalescer.enqueue({ type: isNewItem ? "itemNew" : "itemKnown", orderId, itemId })
          }
        },
      )
      .subscribe()

    // Suscribirse a eliminaciones de órdenes
    const orderDeletesChannel = supabase
      .channel("kitchen-order-deletes-channel")
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "orders",
        },
        (payload) => {
          log.info("Orden eliminada:", { payload })

          // Eliminar la orden del registro de items conocidos
          if (payload.old && payload.old.id) forgetOrderItems(payload.old.id)

          // Llamar al callback con los datos de la orden eliminada
          orderDeleteCallback(payload)
        },
      )
      .subscribe()

    // Guardar referencias a los canales
    realtimeService.channels["kitchen-status"] = statusChannel
    realtimeService.channels["kitchen-orders"] = ordersChannel
    realtimeService.channels["kitchen-new-items"] = newItemsChannel
    realtimeService.channels["kitchen-item-updates"] = itemUpdatesChannel
    realtimeService.channels["kitchen-order-deletes"] = orderDeletesChannel

    log.info("Suscripción a cocina configurada correctamente")

    // Devolver función para cancelar todas las suscripciones
    return () => {
      // Los lotes pendientes se descartan: quien reabre la suscripción
      // invalida la query de cocina, que vuelve a leer la cola entera.
      coalescer.dispose()

      supabase.removeChannel(statusChannel)
      supabase.removeChannel(ordersChannel)
      supabase.removeChannel(newItemsChannel)
      supabase.removeChannel(itemUpdatesChannel)
      supabase.removeChannel(orderDeletesChannel)

      delete realtimeService.channels["kitchen-status"]
      delete realtimeService.channels["kitchen-orders"]
      delete realtimeService.channels["kitchen-new-items"]
      delete realtimeService.channels["kitchen-item-updates"]
      delete realtimeService.channels["kitchen-order-deletes"]

      // Limpiar el registro de items conocidos
      realtimeService.knownItems = {}
      kitchenLocalChanges.dispose()
      realtimeService.isConnected = false
    }
  },

  // Obtener el estado de todos los canales (para depuración)
  getChannelsStatus: () => {
    const channelIds = Object.keys(realtimeService.channels)
    return {
      channels: channelIds.map((id) => ({ id, active: true })),
      totalChannels: channelIds.length,
      activeChannels: channelIds.length,
      isConnected: realtimeService.isConnected,
    }
  },

  // Verificar si un item es nuevo para una orden
  isNewItem: (orderId: string, itemId: string): boolean => {
    return !realtimeService.knownItems[orderId]?.has(itemId)
  },

  // Marcar items cuyo próximo evento realtime es una escritura de ESTA cocina
  // (marcar un producto como servido). Debe llamarse ANTES de la escritura:
  // el eco puede llegar antes de que la promesa resuelva.
  markLocalItemChanges: (itemIds: readonly string[]): void => {
    kitchenLocalChanges.mark(itemIds)
  },

  // Desmarcar cuando la escritura falló y ningún eco llegará, para no tragarse
  // un cambio real posterior del mismo item.
  unmarkLocalItemChanges: (itemIds: readonly string[]): void => {
    kitchenLocalChanges.unmark(itemIds)
  },

  // Registrar un item como conocido
  registerItem: (orderId: string, itemId: string): void => {
    if (!realtimeService.knownItems[orderId]) {
      realtimeService.knownItems[orderId] = new Set()
    }
    realtimeService.knownItems[orderId].add(itemId)
    log.info(`Registrando item ${itemId} para orden ${orderId}`)
  },

  // Registrar múltiples items como conocidos
  registerItems: (orderId: string, itemIds: string[]): void => {
    if (!realtimeService.knownItems[orderId]) {
      realtimeService.knownItems[orderId] = new Set()
    }
    itemIds.forEach((id) => realtimeService.knownItems[orderId].add(id))
    log.info(`Registrando ${itemIds.length} items para orden ${orderId}`)
  },

  // Eliminar un item del registro
  unregisterItem: (orderId: string, itemId: string): void => {
    if (realtimeService.knownItems[orderId]) {
      realtimeService.knownItems[orderId].delete(itemId)
      log.info(`Eliminando registro de item ${itemId} para orden ${orderId}`)
    }
  },

  // Eliminar una orden completa del registro
  unregisterOrder: (orderId: string): void => {
    if (realtimeService.knownItems[orderId]) {
      delete realtimeService.knownItems[orderId]
      log.info(`Eliminando registro completo para orden ${orderId}`)
    }
  },

  // Cancelar todas las suscripciones
  unsubscribeAll: () => {
    Object.values(realtimeService.channels).forEach((channel) => {
      supabase.removeChannel(channel)
    })
    realtimeService.channels = {}
    realtimeService.knownItems = {}
    realtimeService.isConnected = false
  },
}
