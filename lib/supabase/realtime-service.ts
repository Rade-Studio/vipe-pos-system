import { supabase } from "./client"
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js"
import { orderService } from "./service"
import {toast} from "@/components/ui/use-toast";
import {CartItem, PrintableInvoice, Order} from "@/types";

// Tipos para las funciones de callback
type BillPayload = {
  invoiceNumber: string;
  invoice: any;
  displayItems: any[];
};
type TableCallback = (payload: RealtimePostgresChangesPayload<any>) => void
type OrderCallback = (payload: RealtimePostgresChangesPayload<Order>, isNewOrder?: boolean) => void
type OrderItemCallback = (payload: RealtimePostgresChangesPayload<any>, isNewItem?: boolean) => void
type ConnectionStatusCallback = (status: boolean) => void
type PosEventCallback = (payload: BillPayload) => void

// Servicio para manejar suscripciones en tiempo real
export const realtimeService = {
  // Canales activos
  channels: {} as Record<string, RealtimeChannel>,

  // Registro de items conocidos por orden
  knownItems: {} as Record<string, Set<string>>,

  // Estado de la conexión
  isConnected: false,

  // Suscribirse a cambios en las mesas
  subscribeToTables: (callback: TableCallback) => {
    // Crear un canal para las mesas
    const channel = supabase
      .channel("tables-changes")
      .on(
        "postgres_changes",
        {
          event: "*", // Escuchar todos los eventos (INSERT, UPDATE, DELETE)
          schema: "public",
          table: "tables",
        },
        callback,
      )
      .subscribe()

    // Guardar referencia al canal
    realtimeService.channels["tables"] = channel
    realtimeService.isConnected = true

    // Devolver función para cancelar la suscripción
    return () => {
      supabase.removeChannel(channel)
      delete realtimeService.channels["tables"]
    }
  },

  subscribeToPosEvents: (callback: PosEventCallback) => {
    const channelKey = "room_facturas"

    if (!realtimeService.channels[channelKey]) {
      const channel = supabase.channel(channelKey)

      channel.on("broadcast", { event: "new_invoice"}, ({payload}) => {
        callback(payload as BillPayload)
      })

      channel.subscribe(() => {
        realtimeService.isConnected = true
      })

      realtimeService.channels[channelKey] = channel

    }

  },

  // enviar factura a un canal de realtime
  sendFactura: (invoiceNumber: string, invoice: PrintableInvoice, displayItems: CartItem[]) => {
    // enviar factura por broadcast
    const channelKey = "room_facturas"
    realtimeService.subscribeToPosEvents(() => {})
    const payload = {
      invoiceNumber,
      invoice,
      displayItems,
    }

    realtimeService.channels[channelKey].send({
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

  // Suscribirse a cambios en las órdenes
  subscribeToOrders: (callback: OrderCallback) => {
    // Crear un canal para las órdenes
    const channel = supabase
      .channel("orders-changes")
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
              // Obtener los items de la orden
              const { data: orderItems, error } = await supabase
                .from("order_items")
                .select("*")
                .eq("order_id", payload.new.id)

              if (error) {
                return
              }

              // Añadir los items a la orden
              payload.new.order_items = orderItems || []

              // Asegurarse de que todos los campos necesarios estén presentes
            } catch (error) {
              toast({
                title: "Error",
                description: "No se pudo procesar el cambio de orden. Intente nuevamente.",
                variant: "destructive",
              })
            }
          }

          // Llamar al callback con los datos completos
          callback(payload)
        },
      )
      .subscribe()

    // Guardar referencia al canal
    realtimeService.channels["orders"] = channel
    realtimeService.isConnected = true

    // Devolver función para cancelar la suscripción
    return () => {
      supabase.removeChannel(channel)
      delete realtimeService.channels["orders"]
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
      if (status === "SUBSCRIBED") {
        console.log("Suscripción a cocina activada")
        connectionStatusCallback(true)
        realtimeService.isConnected = true
      } else {
        console.log("Estado de suscripción:", status)
        connectionStatusCallback(status === "SUBSCRIBED")
        realtimeService.isConnected = status === "SUBSCRIBED"
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
          filter: "status=eq.active",
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
                },
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
                })

                // Si no quedan items en cocina, limpiar el registro de esta orden
                if (remainingKitchenItems.length === 0 && realtimeService.knownItems[orderId]) {
                  delete realtimeService.knownItems[orderId]
                }
              }
            } catch (error) {
              console.error("Error al actualizar orden tras cambio de estado de item:", error)
            }
          }
          // Si el estado cambió a "kitchen"
          else if (payload.new.status === "kitchen") {
            try {
              const orderId = payload.new.order_id
              const itemId = payload.new.id

              // Verificar si este item ya es conocido
              const isNewItem = !realtimeService.knownItems[orderId]?.has(itemId)
              console.log(`Item ${itemId} actualizado a estado kitchen, es nuevo: ${isNewItem}`)

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
                  },
                  isNewItem,
                )
              }
            } catch (error) {
              console.error("Error al procesar item actualizado a estado kitchen:", error)
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
          console.log("Orden eliminada:", payload)

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

    console.log("Suscripción a cocina configurada correctamente")

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
    console.log(`Registrando item ${itemId} para orden ${orderId}`)
  },

  // Registrar múltiples items como conocidos
  registerItems: (orderId: string, itemIds: string[]): void => {
    if (!realtimeService.knownItems[orderId]) {
      realtimeService.knownItems[orderId] = new Set()
    }
    itemIds.forEach((id) => realtimeService.knownItems[orderId].add(id))
    console.log(`Registrando ${itemIds.length} items para orden ${orderId}`)
  },

  // Eliminar un item del registro
  unregisterItem: (orderId: string, itemId: string): void => {
    if (realtimeService.knownItems[orderId]) {
      realtimeService.knownItems[orderId].delete(itemId)
      console.log(`Eliminando registro de item ${itemId} para orden ${orderId}`)
    }
  },

  // Eliminar una orden completa del registro
  unregisterOrder: (orderId: string): void => {
    if (realtimeService.knownItems[orderId]) {
      delete realtimeService.knownItems[orderId]
      console.log(`Eliminando registro completo para orden ${orderId}`)
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
