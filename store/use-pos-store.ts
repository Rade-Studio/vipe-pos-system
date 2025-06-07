import { create } from "zustand"
import { v4 as uuidv4 } from "uuid"
import type { Table, CartItem, Order, Profile, Dish, Category } from "@/types"
import { supabase } from "@/lib/db/client"
import { tableService } from "@/lib/services/tables/table.service"
import { orderService } from "@/lib/services/orders/order.service"
import {Payment} from "@/types/models";

interface POSState {
  // Tables
  tables: Table[]
  activeTable: string | null
  setTables: (tables: Table[]) => void
  setActiveTable: (tableId: string | null) => void
  reserveTable: (tableId: string, waiterId: string) => void
  releaseTable: (tableId: string) => void
  updateTableStatus: (tableId: string, status: Table["status"]) => void
  isTableAccessibleByWaiter: (tableId: string, waiterId: string) => boolean
  assignWaiterToTable: (tableId: string, waiterId: string) => void
  getTableWaiter: (tableId: string) => string | undefined

  // Cart
  cartItems: Record<string, CartItem[]>
  addToCart: (tableId: string, item: CartItem) => void
  updateQuantity: (tableId: string, itemId: string, quantity: number) => void
  updateItemComments: (tableId: string, itemId: string, comments: string) => void
  removeFromCart: (tableId: string, itemId: string) => void
  clearCart: (tableId: string) => void
  getCartByTable: (tableId: string) => CartItem[]
  getCartTotal: (tableId: string) => number
  calculateOrderBill: (items: CartItem[], tipPercentage?: number, taxPercentage?: number) => Order["bill"]

  // Orders
  orders: Order[]
  addOrder: (order: Order) => void
  // Actualizar una orden existente
  updateOrder: (orderId: string, updatedOrder: Order) => void
  // Eliminar una orden
  removeOrder: (orderId: string) => void
  updateOrderStatus: (orderId: string, status: Order["status"]) => void
  getOrdersByStatus: (status: Order["status"][]) => Order[]
  getOrdersByTable: (tableId: string) => Order[]
  setOrders: (orders: Order[]) => void
  loadOrders: () => Promise<void>
  getOrderById: (orderId: string) => Order | undefined
  completePayment: (orderId: string, paymentMethod?: Payment["method"]) => Promise<string>
  completePartialPayment: (orderId: string, selectedItems: string[]) => Promise<string>
  createPartialOrder: (orderId: string, selectedItems: { itemId: string; quantity: number }[]) => Promise<string>
  deletePartialOrder: (orderId: string) => Promise<void>
  undoPartialPayment: (orderId: string) => Promise<void>
  getTableTotalAmount: (tableId: string) => number

  // Analytics
  getTotalSales: () => number
  getCompletedOrdersCount: () => number
  getAverageOrderValue: () => number
  getDailySales: (days: number) => { date: string; amount: number }[]
  getPopularDishes: (limit: number) => { name: string; count: number }[]
  getCategorySales: () => { category: string; amount: number }[]

  // Profiles
  profiles: Profile[]
  setProfiles: (profiles: Profile[]) => void

  // Menu
  categories: Category[]
  dishes: Dish[]
  setCategories: (categories: Category[]) => void
  setDishes: (dishes: Dish[]) => void
}

export const usePOSStore = create<POSState>((set, get) => ({
  // Tables
  tables: [],
  activeTable: null,
  setTables: (tables) => {
    // Verificar si las mesas son iguales a las actuales para evitar actualizaciones innecesarias
    const currentTables = get().tables

    // Si las tablas son las mismas (misma longitud y mismos IDs), no actualizar
    if (
      currentTables.length === tables.length &&
      currentTables.every((currentTable) =>
        tables.some(
          (newTable) =>
            newTable.id === currentTable.id &&
            newTable.status === currentTable.status &&
            newTable.waiter === currentTable.waiter,
        ),
      )
    ) {
      return
    }

    set({ tables })
  },
  setActiveTable: (tableId) => set({ activeTable: tableId }),
  reserveTable: (tableId, waiterId) =>
    set((state) => ({
      tables: state.tables.map((table) =>
        table.id === tableId ? { ...table, status: "reserved", waiter: waiterId } : table,
      ),
    })),
  releaseTable: (tableId) => {
    set((state) => {
      // Verificar si la mesa ya está disponible para evitar actualizaciones innecesarias
      const table = state.tables.find((t) => t.id === tableId)
      if (table && table.status === "available" && !table.waiter) {
        return state // Devolver el estado sin cambios
      }

      const tables = state.tables.map((table) =>
        table.id === tableId ? { ...table, status: "available", waiter: undefined } : table,
      )
      return { tables }
    })
  },
  updateTableStatus: (tableId, status) => {
    set((state) => {
      // Verificar si el estado ya es el mismo para evitar actualizaciones innecesarias
      const table = state.tables.find((t) => t.id === tableId)
      if (table && table.status === status) {
        console.log(`La mesa ${tableId} ya tiene el estado ${status}, evitando actualización innecesaria`)
        return state // Devolver el estado sin cambios
      }

      console.log(`Actualizando estado de mesa ${tableId} a ${status} en el store`)
      const tables = state.tables.map((table) => {
        if (table.id === tableId) {
          // Mantener el mismo mesero al cambiar el estado
          return { ...table, status: status as Table["status"] }
        }
        return table
      })
      return { tables }
    })
  },
  isTableAccessibleByWaiter: (tableId, waiterId) => {
    const table = get().tables.find((t) => t.id === tableId)
    if (!table) return false
    return table.status === "available" || table.waiter === waiterId
  },
  assignWaiterToTable: (tableId, waiterId) => {
    set((state) => {
      // Verificar si el mesero ya está asignado para evitar actualizaciones innecesarias
      const table = state.tables.find((t) => t.id === tableId)
      if (table && table.waiter === waiterId && table.status === "occupied") {
        return state // Devolver el estado sin cambios
      }

      const tables = state.tables.map((table) => {
        if (table.id === tableId) {
          return { ...table, waiter: waiterId, status: "occupied" as Table["status"] }
        }
        return table
      })
      return { tables }
    })
  },
  getTableWaiter: (tableId) => {
    const table = get().tables.find((t) => t.id === tableId)
    return table?.waiter
  },

  // Cart
  cartItems: {},
  addToCart: (tableId, newItem) =>
    set((state) => {
      const tableCart = state.cartItems[tableId] || []

      // Buscar si ya existe un producto exactamente igual (mismo ID base y mismos comentarios)
      const existingItemIndex = tableCart.findIndex((item) => {
        // Extraer el ID base del item existente (sin el UUID)
        const itemBaseId = item.id.includes("-") ? item.id.split("-")[0] : item.id
        const newItemBaseId = newItem.id.includes("-") ? newItem.id.split("-")[0] : newItem.id

        // Comparar ID base y comentarios
        return (
          itemBaseId === newItemBaseId && (item.comments === newItem.comments || (!item.comments && !newItem.comments))
        )
      })

      if (existingItemIndex !== -1) {
        // Si existe un producto exactamente igual, aumentar su cantidad
        const updatedCart = [...tableCart]
        updatedCart[existingItemIndex] = {
          ...updatedCart[existingItemIndex],
          quantity: updatedCart[existingItemIndex].quantity + newItem.quantity,
        }
        return {
          cartItems: {
            ...state.cartItems,
            [tableId]: updatedCart,
          },
        }
      } else {
        // Si no existe, agregar como nuevo producto con un ID único
        return {
          cartItems: {
            ...state.cartItems,
            [tableId]: [...tableCart, { ...newItem, id: newItem.id }],
          },
        }
      }
    }),
  updateQuantity: (tableId, itemId, quantity) =>
    set((state) => {
      const tableCart = state.cartItems[tableId] || []
      if (quantity <= 0) {
        // Si la cantidad es 0 o menor, eliminar solo este producto específico
        return {
          cartItems: {
            ...state.cartItems,
            [tableId]: tableCart.filter((item) => item.id !== itemId),
          },
        }
      }
      // Actualizar la cantidad solo para este producto específico
      return {
        cartItems: {
          ...state.cartItems,
          [tableId]: tableCart.map((item) => (item.id === itemId ? { ...item, quantity } : item)),
        },
      }
    }),
  updateItemComments: (tableId, itemId, comments) =>
    set((state) => {
      const tableCart = state.cartItems[tableId] || []
      // Actualizar los comentarios solo para este producto específico
      return {
        cartItems: {
          ...state.cartItems,
          [tableId]: tableCart.map((item) => (item.id === itemId ? { ...item, comments } : item)),
        },
      }
    }),
  removeFromCart: (tableId, itemId) =>
    set((state) => {
      const tableCart = state.cartItems[tableId] || []
      // Eliminar solo este producto específico
      return {
        cartItems: {
          ...state.cartItems,
          [tableId]: tableCart.filter((item) => item.id !== itemId),
        },
      }
    }),
  clearCart: (tableId) =>
    set((state) => ({
      cartItems: {
        ...state.cartItems,
        [tableId]: [],
      },
    })),
  getCartByTable: (tableId) => {
    return get().cartItems[tableId] || []
  },
  getCartTotal: (tableId) => {
    const items = get().cartItems[tableId] || []
    return items.reduce((total, item) => total + item.price * item.quantity, 0)
  },
  calculateOrderBill: (items, tipPercentage = 10, taxPercentage = 8) => {
    // Calcular el subtotal (precio con descuento ya aplicado)
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0)

    // Calcular el total de descuentos
    const totalDiscounts = items.reduce((sum, item) => {
      // Si el item tiene precio original y es mayor que el precio actual, hay un descuento
      if (item.originalPrice && item.originalPrice > item.price) {
        return sum + (item.originalPrice - item.price) * item.quantity
      }
      return sum
    }, 0)

    // Calcular impuestos y propina
    const tax = Math.round(subtotal * (taxPercentage / 100))
    const tip = Math.round(subtotal * (tipPercentage / 100))

    // Calcular el total
    const total = subtotal + tax + tip

    return {
      subtotal,
      tax,
      taxPercentage,
      tip,
      tipPercentage,
      total,
      totalDiscounts,
    }
  },

  // Orders
  orders: [],
  addOrder: (order) => {
    set((state) => {
      // Check if the order already exists
      const exists = state.orders.some((o) => o.id === order.id)
      if (exists) {
        return state // Return state unchanged if order exists
      }
      return { orders: [...state.orders, order] }
    })
  },
  // Actualizar una orden existente
  updateOrder: (orderId: string, updatedOrder: Order) => {
    set((state) => ({
      orders: state.orders.map((order) => (order.id === orderId ? { ...updatedOrder } : order)),
    }))
  },

  // Eliminar una orden
  removeOrder: (orderId: string) => {
    set((state) => ({
      orders: state.orders.filter((order) => order.id !== orderId),
    }))
  },
  updateOrderStatus: (orderId, status) =>
    set((state) => ({
      orders: state.orders.map((order) => (order.id === orderId ? { ...order, status } : order)),
    })),
  // Modificar la función getOrdersByStatus para asegurarnos de que filtra correctamente
  getOrdersByStatus: (statuses) => {
    const filteredOrders = get().orders.filter((order) => statuses.includes(order.status))
    console.log("Filtrando órdenes por estados:", statuses, "Resultado:", filteredOrders.length)
    return filteredOrders
  },
  getOrdersByTable: (tableId) => {
    return get().orders.filter((order) => order.tableId === tableId)
  },
  setOrders: (orders) => set({ orders }),
  // Revisemos la función loadOrders para asegurarnos de que el waiter_id se carga correctamente

  // Modificar la función loadOrders para asegurarnos de que carga correctamente las órdenes activas
  loadOrders: async () => {
    try {
      // Cargar órdenes en cocina, entregadas y activas
      const kitchenOrders = await orderService.getByStatus(["kitchen"])
      const deliveredOrders = await orderService.getByStatus(["delivered"])
      const activeOrders = await orderService.getByStatus(["active"])

      console.log("Órdenes activas cargadas:", activeOrders.length)
      console.log("Órdenes en cocina cargadas:", kitchenOrders.length)
      console.log("Órdenes entregadas cargadas:", deliveredOrders.length)

      // Combinar las órdenes
      const dbOrders = [...kitchenOrders, ...deliveredOrders, ...activeOrders]

      console.log(
        "Órdenes cargadas de la BD:",
        dbOrders.map((o) => ({
          id: o.id,
          table_id: o.table_id,
          waiter_id: o.waiter_id,
          status: o.status,
        })),
      )

      // Obtener los IDs de las órdenes que ya están en el store
      const existingOrderIds = get().orders.map((order) => order.id)

      // Filtrar solo las órdenes que no existen en el store
      const newOrders = dbOrders.filter((dbOrder) => !existingOrderIds.includes(dbOrder.id))

      if (newOrders.length > 0) {
        // Convertir las órdenes de la base de datos al formato que espera el store
        const storeOrders = newOrders.map((dbOrder) => {
          // Convertir los items de la orden
          const items = dbOrder.order_items.map((item) => ({
            id: item.id,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            comments: item.comments || undefined,
            categoryId: item.category_id || "",
            // Añadir campos de promoción si existen
            originalPrice: item.original_price,
            discountAmount: item.discount_amount,
            discountPercentage: item.discount_percentage,
            promotionId: item.promotion_id,
            promotionName: item.promotion_name,
          }))

          // Crear el objeto de orden para el store
          const storeOrder = {
            id: dbOrder.id,
            tableId: dbOrder.table_id,
            items,
            status: dbOrder.status,
            bill: {
              subtotal: dbOrder.subtotal,
              tax: dbOrder.tax,
              taxPercentage: dbOrder.tax_percentage,
              tip: dbOrder.tip,
              tipPercentage: dbOrder.tip_percentage,
              total: dbOrder.total,
              totalDiscounts: dbOrder.total_discounts || 0,
            },
            waiter: dbOrder.waiter_id,
            createdAt: new Date(dbOrder.created_at),
            isPartialOrder: dbOrder.is_partial_order || false,
            parentOrderId: dbOrder.parent_order_id || null,
          }

          console.log("Orden convertida para el store:", {
            id: storeOrder.id,
            tableId: storeOrder.tableId,
            waiter: storeOrder.waiter,
            status: storeOrder.status,
          })

          return storeOrder
        })

        // Actualizar todas las órdenes de una vez
        set((state) => ({
          orders: [...state.orders, ...storeOrders],
        }))
      }
    } catch (err) {
      console.error("Error al cargar órdenes:", err)
      throw err
    }
  },
  // Revisemos la función getOrderById para asegurarnos de que devuelve correctamente la orden con el ID del mesero

  getOrderById: (orderId) => {
    const order = get().orders.find((order) => order.id === orderId)

    if (order) {
      console.log("Orden encontrada en el store:", {
        id: order.id,
        tableId: order.tableId,
        waiter: order.waiter,
        status: order.status,
      })
    } else {
      console.log("Orden no encontrada en el store:", orderId)
    }

    return order
  },
  // Buscar la función completePayment y reemplazarla con esta versión más robusta
  completePayment: async (orderId) => {
    try {
      // Intentar obtener la orden del store
      const order = get().getOrderById(orderId)

      // Completar el pago en la base de datos (esto funciona correctamente)
      const invoiceNumber = await orderService.completePayment(orderId, "cash")

      // Actualizar el estado de la orden en el store si existe
      if (order) {
        set((state) => ({
          orders: state.orders.map((o) => (o.id === orderId ? { ...o, status: "paid" } : o)),
        }))

        // Verificar si hay otras órdenes activas para esta mesa
        const activeOrders = get()
          .getOrdersByTable(order.tableId)
          .filter(
            (o) => o.id !== orderId && (o.status === "kitchen" || o.status === "delivered" || o.status === "active"),
          )

        if (activeOrders.length === 0) {
          // Si no hay otras órdenes activas, liberar la mesa
          console.log(`No hay más órdenes activas para la mesa ${order.tableId}, liberando...`)
          get().releaseTable(order.tableId)
        }
      } else {
        // Si la orden no está en el store, intentar obtener la información de la mesa desde la base de datos
        try {
          const dbOrder = await orderService.getById(orderId)
          if (dbOrder && dbOrder.table_id) {
            // Verificar si hay otras órdenes activas para esta mesa
            const { data: activeOrders } = await supabase
              .from("orders")
              .select("id")
              .eq("table_id", dbOrder.table_id)
              .neq("id", orderId)
              .neq("status", "paid")

            if (!activeOrders || activeOrders.length === 0) {
              // Si no hay otras órdenes activas, liberar la mesa
              console.log(`No hay más órdenes activas para la mesa ${dbOrder.table_id}, liberando...`)
              await tableService.releaseTable(dbOrder.table_id)
            }
          }
        } catch (dbError) {
          console.log("Error al obtener información de la orden desde la base de datos:", dbError)
          // No lanzamos este error para no interrumpir el flujo principal
        }
      }

      return invoiceNumber
    } catch (error) {
      console.error("Error al completar pago:", error)
      throw error
    }
  },

  // También actualizar la función completePartialPayment para hacerla más robusta
  completePartialPayment: async (orderId, selectedItems) => {
    try {
      // Completar el pago parcial en la base de datos
      const invoiceNumber = await orderService.completePartialPayment(orderId, selectedItems)

      // Actualizar el estado de la orden en el store si existe
      const order = get().getOrderById(orderId)
      if (order) {
        set((state) => ({
          orders: state.orders.map((o) => (o.id === orderId ? { ...o, status: "paid" } : o)),
        }))
      }

      return invoiceNumber
    } catch (error) {
      console.error("Error al completar pago parcial:", error)
      throw error
    }
  },
  createPartialOrder: async (orderId, selectedItems) => {
    try {
      const parentOrder = get().getOrderById(orderId)
      if (!parentOrder) throw new Error("No se encontró la orden padre")

      // Filtrar los items seleccionados
      const partialItems = parentOrder.items
        .filter((item) => selectedItems.some((selected) => selected.itemId === item.id && selected.quantity > 0))
        .map((item) => {
          const selectedItem = selectedItems.find((selected) => selected.itemId === item.id)
          return {
            ...item,
            quantity: selectedItem ? selectedItem.quantity : item.quantity,
          }
        })

      // Calcular el total de la orden parcial
      const bill = get().calculateOrderBill(partialItems)

      // Crear la orden parcial en la base de datos
      const partialOrderData = await orderService.createPartialOrder(orderId, partialItems, bill)

      // Actualizar la orden original en el store
      // Eliminar los items que se movieron a la orden parcial
      const updatedItems = parentOrder.items.filter(
        (item) => !partialItems.some((pi) => pi.id === item.id && pi.quantity === item.quantity),
      )

      // Reducir la cantidad de los items que se movieron parcialmente
      const reducedItems = parentOrder.items
        .filter((item) => partialItems.some((pi) => pi.id === item.id && pi.quantity < item.quantity))
        .map((item) => {
          const partialItem = partialItems.find((pi) => pi.id === item.id)
          return {
            ...item,
            quantity: item.quantity - (partialItem?.quantity || 0),
          }
        })

      // Combinar los items que no se movieron con los que se redujeron
      const remainingItems = [...updatedItems, ...reducedItems]

      // Recalcular el total de la orden original
      const updatedBill = get().calculateOrderBill(remainingItems)

      // Actualizar la orden original en el store inmediatamente
      set((state) => ({
        orders: state.orders.map((o) => (o.id === orderId ? { ...o, items: remainingItems, bill: updatedBill } : o)),
      }))

      // Crear la orden parcial en el store manualmente para evitar retrasos
      const newPartialOrder = {
        id: partialOrderData.id,
        tableId: parentOrder.tableId,
        items: partialItems,
        status: "active",
        bill: bill,
        waiter: parentOrder.waiter,
        createdAt: new Date(),
        isPartialOrder: true,
        parentOrderId: orderId,
      }

      // Añadir la orden parcial al store
      set((state) => ({
        orders: [...state.orders, newPartialOrder],
      }))

      return partialOrderData.id
    } catch (error) {
      console.error("Error al crear orden parcial:", error)
      throw error
    }
  },
  deletePartialOrder: async (orderId) => {
    try {
      // Eliminar la orden parcial de la base de datos
      await orderService.deletePartialOrder(orderId)

      // Obtener la orden parcial del store
      const partialOrder = get().getOrderById(orderId)
      if (!partialOrder || !partialOrder.isPartialOrder || !partialOrder.parentOrderId) {
        throw new Error("No es una orden parcial válida")
      }

      // Obtener la orden original
      const parentOrder = get().getOrderById(partialOrder.parentOrderId)
      if (!parentOrder) {
        throw new Error("No se encontró la orden original")
      }

      // Combinar los items de la orden parcial con la original
      const updatedItems = [...parentOrder.items]

      // Para cada item en la orden parcial
      partialOrder.items.forEach((partialItem) => {
        // Buscar si el item ya existe en la orden original
        const existingItemIndex = updatedItems.findIndex(
          (item) => item.name === partialItem.name && item.comments === partialItem.comments,
        )

        if (existingItemIndex !== -1) {
          // Si existe, actualizar la cantidad
          updatedItems[existingItemIndex] = {
            ...updatedItems[existingItemIndex],
            quantity: updatedItems[existingItemIndex].quantity + partialItem.quantity,
          }
        } else {
          // Si no existe, agregar el item
          updatedItems.push(partialItem)
        }
      })

      // Recalcular el total de la orden original
      const updatedBill = get().calculateOrderBill(updatedItems)

      // Actualizar la orden original en el store
      set((state) => ({
        orders: state.orders.map((o) =>
          o.id === parentOrder.id ? { ...o, items: updatedItems, bill: updatedBill } : o,
        ),
      }))

      // Eliminar la orden parcial del store
      set((state) => ({
        orders: state.orders.filter((order) => order.id !== orderId),
      }))
    } catch (error) {
      console.error("Error al eliminar orden parcial:", error)
      throw error
    }
  },
  undoPartialPayment: async (orderId) => {
    try {
      const partialOrder = get().getOrderById(orderId)
      if (!partialOrder || !partialOrder.isPartialOrder || !partialOrder.parentOrderId) {
        throw new Error("No es una orden parcial válida")
      }

      // Eliminar la orden parcial
      await get().deletePartialOrder(orderId)
    } catch (error) {
      console.error("Error al deshacer pago parcial:", error)
      throw error
    }
  },
  getTableTotalAmount: (tableId) => {
    const orders = get().getOrdersByTable(tableId)
    return orders.reduce((total, order) => total + order.bill.total, 0)
  },
  removeOrder: (orderId: string) =>
    set((state) => ({
      orders: state.orders.filter((order) => order.id !== orderId),
    })),

  // Analytics
  getTotalSales: () => {
    return get()
      .orders.filter((order) => order.status === "paid")
      .reduce((total, order) => total + order.bill.total, 0)
  },
  getCompletedOrdersCount: () => {
    return get().orders.filter((order) => order.status === "paid").length
  },
  getAverageOrderValue: () => {
    const completedOrders = get().orders.filter((order) => order.status === "paid")
    if (completedOrders.length === 0) return 0
    return get().getTotalSales() / completedOrders.length
  },
  getDailySales: (days) => {
    const result = []
    const today = new Date()

    for (let i = 0; i < days; i++) {
      const date = new Date(today)
      date.setDate(today.getDate() - i)
      const dateStr = date.toISOString().split("T")[0]

      const amount = get()
        .orders.filter((order) => order.status === "paid" && order.createdAt.toISOString().split("T")[0] === dateStr)
        .reduce((sum, order) => sum + order.bill.total, 0)

      result.push({ date: dateStr, amount })
    }

    return result
  },
  getPopularDishes: (limit) => {
    const dishCounts = {}

    get()
      .orders.filter((order) => order.status === "paid")
      .forEach((order) => {
        order.items.forEach((item) => {
          if (!dishCounts[item.name]) {
            dishCounts[item.name] = 0
          }
          dishCounts[item.name] += item.quantity
        })
      })

    return Object.entries(dishCounts)
      .map(([name, count]) => ({ name, count: count as number }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
  },
  getCategorySales: () => {
    const categorySales = {}

    get()
      .orders.filter((order) => order.status === "paid")
      .forEach((order) => {
        order.items.forEach((item) => {
          if (!categorySales[item.categoryId]) {
            categorySales[item.categoryId] = 0
          }
          categorySales[item.categoryId] += item.price * item.quantity
        })
      })

    return Object.entries(categorySales).map(([category, amount]) => ({ category, amount: amount as number }))
  },

  // Profiles
  profiles: [],
  setProfiles: (profiles) => set({ profiles }),

  // Menu
  categories: [],
  dishes: [],
  setCategories: (categories) => set({ categories }),
  setDishes: (dishes) => set({ dishes }),
}))
