import { supabase } from "./client"
import {
  type RealtimeChannel,
  type RealtimePostgresChangesPayload,
  REALTIME_SUBSCRIBE_STATES,
} from "@supabase/supabase-js"
import { orderService } from "./service"
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
type OrderItemCallback = (payload: RealtimePostgresChangesPayload<any>, isNewItem?: boolean) => void
type ConnectionStatusCallback = (status: boolean) => void

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

  // Suscribirse a cambios en la cocina (órdenes y productos)
  subscribeToKitchen: (
    orderCallback: OrderCallback,
    orderItemCallback: OrderItemCallback,
    connectionStatusCallback: ConnectionStatusCallback,
  ) => {
    // Inicializar el registro de items conocidos
    realtimeService.knownItems = {}

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

    // Suscribirse a inserciones en la tabla orders con filtro para estado "active"
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
        async (payload) => {
          // Cargar la orden completa con sus items
          try {
            const orderId = payload.new.id
            const orderDetails = await orderService.getById(orderId)

            if (orderDetails) {

              // Verificar si hay items en estado "kitchen"
              const kitchenItems = orderDetails.order_items?.filter((item) => item.status === "kitchen") || []

              if (kitchenItems.length > 0) {
                // Inicializar el conjunto de items conocidos para esta orden
                if (!realtimeService.knownItems[orderId]) {
                  realtimeService.knownItems[orderId] = new Set()
                }

                // Registrar los items de esta orden
                kitchenItems.forEach((item) => {
                  realtimeService.knownItems[orderId].add(item.id)
                })

                // Llamar al callback con los datos completos y marcar como nueva orden
                orderCallback(
                  {
                    ...payload,
                    new: {
                      ...orderDetails,
                      isNewOrder: true,
                    },
                  },
                  true,
                )
              }
            }
          } catch (error) {
            toast({
              title: "Error",
              description: "No se pudo cargar los detalles de la nueva orden. Intente nuevamente.",
              variant: "destructive",
            })
          }
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
        async (payload) => {
          try {
            // Obtener el ID de la orden y del item
            const orderId = payload.new.order_id
            const itemId = payload.new.id

            // Verificar si este item ya es conocido
            const isNewItem = !realtimeService.knownItems[orderId]?.has(itemId)

            // Si es un nuevo item, registrarlo
            if (isNewItem) {
              if (!realtimeService.knownItems[orderId]) {
                realtimeService.knownItems[orderId] = new Set()
              }
              realtimeService.knownItems[orderId].add(itemId)
            }

            // Cargar la orden completa con sus items
            const orderDetails = await orderService.getById(orderId)

            if (orderDetails) {
              // Llamar al callback con los datos completos
              orderItemCallback(
                {
                  ...payload,
                  order: orderDetails,
                  isNewItem: isNewItem,
                  newItemId: itemId, // Añadir el ID del nuevo item explícitamente
                } as any,
                isNewItem,
              )
            }
          } catch (error) {
            toast({
              title: "Error",
              description: "No se pudo procesar el nuevo item de orden. Intente nuevamente.",
              variant: "destructive",
            })
          }
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
        async (payload) => {

          // Si el estado cambió de "kitchen" a otro estado
          if (payload.old.status === "kitchen" && payload.new.status !== "kitchen") {
            try {
              const orderId = payload.new.order_id
              const itemId = payload.new.id

              // Cargar la orden para verificar si todavía tiene items en cocina
              const orderDetails = await orderService.getById(orderId)

              if (orderDetails) {
                // Verificar si hay más items en estado "kitchen"
                const remainingKitchenItems =
                  orderDetails.order_items?.filter((item) => item.status === "kitchen") || []

                // Llamar al callback con los datos completos
                orderItemCallback({
                  ...payload,
                  order: orderDetails,
                  remainingItems: remainingKitchenItems.length,
                  itemDelivered: true, // Indicar que un item fue entregado
                  deliveredItemId: itemId, // ID del item entregado
                } as any)

                // Si no quedan items en cocina, limpiar el registro de esta orden
                if (remainingKitchenItems.length === 0 && realtimeService.knownItems[orderId]) {
                  delete realtimeService.knownItems[orderId]
                }
              }
            } catch (error) {
              log.error("Error al actualizar orden tras cambio de estado de item:", { error: String(error) })
            }
          }
          // Si el estado cambió a "kitchen"
          else if (payload.new.status === "kitchen") {
            try {
              const orderId = payload.new.order_id
              const itemId = payload.new.id

              // Verificar si este item ya es conocido
              const isNewItem = !realtimeService.knownItems[orderId]?.has(itemId)
              log.info(`Item ${itemId} actualizado a estado kitchen, es nuevo: ${isNewItem}`)

              // Si es un nuevo item, registrarlo
              if (isNewItem) {
                if (!realtimeService.knownItems[orderId]) {
                  realtimeService.knownItems[orderId] = new Set()
                }
                realtimeService.knownItems[orderId].add(itemId)
              }

              // Cargar la orden completa
              const orderDetails = await orderService.getById(orderId)

              if (orderDetails) {
                // Llamar al callback con los datos completos
                orderItemCallback(
                  {
                    ...payload,
                    order: orderDetails,
                    isNewItem: isNewItem,
                    newItemId: itemId, // Añadir el ID del nuevo item explícitamente
                  } as any,
                  isNewItem,
                )
              }
            } catch (error) {
              log.error("Error al procesar item actualizado a estado kitchen:", { error: String(error) })
            }
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
          if (payload.old && payload.old.id && realtimeService.knownItems[payload.old.id]) {
            delete realtimeService.knownItems[payload.old.id]
          }

          // Llamar al callback con los datos de la orden eliminada
          orderCallback(payload)
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
