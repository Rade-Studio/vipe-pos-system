import type { CartItem, Order, Profile, PaymentMethod } from "@/types"
import { supabase as clientSupabase } from "./client"
import ingredientTransactionService from "./ingredient-transaction-service"
import { log } from "@/lib/log"

// Reutilizar el cliente de Supabase ya inicializado
export const supabase = clientSupabase

// Servicio para ingredientes
export const ingredientService = {
  getAll: async () => {
    try {
      // Obtenemos los ingredientes con un join a las categorías
      const { data: ingredients, error: ingError } = await supabase
        .from("ingredients")
        .select(`
        *,
        ingredient_categories(id, name)
      `)
        .order("name")

      if (ingError) throw ingError

      // Procesamos los datos para un formato más fácil de usar
      return (ingredients || []).map((ingredient) => {
        return {
          ...ingredient,
          category: ingredient.ingredient_categories ? ingredient.ingredient_categories.name : "Sin categoría",
          // Mantenemos el category_id para edición
          category_id: ingredient.category_id,
        }
      })
    } catch (error) {
      log.error("Error en getAll de ingredientes:", { error: String(error) })
      throw error
    }
  },

  getById: async (id: string) => {
    try {
      // Obtenemos el ingrediente con un join a la categoría
      const { data: ingredient, error: ingError } = await supabase
        .from("ingredients")
        .select(`
        *,
        ingredient_categories(id, name)
      `)
        .eq("id", id)
        .single()

      if (ingError) throw ingError

      // Procesamos los datos para un formato más fácil de usar
      return {
        ...ingredient,
        category: ingredient.ingredient_categories ? ingredient.ingredient_categories.name : "Sin categoría",
        // Mantenemos el category_id para edición
        category_id: ingredient.category_id,
      }
    } catch (error) {
      log.error("Error en getById de ingredientes:", { error: String(error) })
      throw error
    }
  },

  create: async (ingredient: any) => {
    const { data, error } = await supabase.from("ingredients").insert([ingredient]).select()
    if (error) throw error
    return data?.[0]
  },

  update: async (id: string, ingredient: any) => {
    const { data, error } = await supabase.from("ingredients").update(ingredient).eq("id", id).select()
    if (error) throw error
    return data?.[0]
  },

  delete: async (id: string) => {
    const { error } = await supabase.from("ingredients").delete().eq("id", id)
    if (error) throw error
    return true
  },
}

// Servicio para categorías de ingredientes
export const ingredientCategoryService = {
  getAll: async () => {
    const { data, error } = await supabase.from("ingredient_categories").select("*").order("name")
    if (error) throw error
    return data || []
  },
}

// Servicio para categorías
export const categoryService = {
  getAll: async () => {
    const { data, error } = await supabase.from("categories").select("*").order("name")
    if (error) throw error
    return data || []
  },

  getAllActive: async () => {
    const { data, error } = await supabase.from("categories").select("*").eq("active", true).order("name")
    if (error) throw error
    return data || []
  },

  getById: async (id: string) => {
    const { data, error } = await supabase.from("categories").select("*").eq("id", id).single()
    if (error) throw error
    return data
  },

  create: async (category: any) => {
    const { data, error } = await supabase.from("categories").insert([category]).select()
    if (error) throw error
    return data?.[0]
  },

  update: async (id: string, category: any) => {
    const { data, error } = await supabase.from("categories").update(category).eq("id", id).select()
    if (error) throw error
    return data?.[0]
  },

  delete: async (id: string) => {
    const { error } = await supabase.from("categories").delete().eq("id", id)
    if (error) throw error
    return true
  },
}

// Servicio para platos
export const dishService = {
  getAll: async () => {
    const { data, error } = await supabase.from("dishes").select("*").order("name")
    if (error) throw error
    return data || []
  },

  getByCategory: async (categoryId: string) => {
    const { data, error } = await supabase
      .from("dishes")
      .select("*")
      .eq("category_id", categoryId)
      .eq("active", true)
      .order("name")
    if (error) throw error
    return data || []
  },

  getById: async (id: string) => {
    const { data, error } = await supabase.from("dishes").select("*").eq("id", id).single()
    if (error) throw error
    return data
  },

  create: async (dish: any) => {
    const { data, error } = await supabase.from("dishes").insert([dish]).select()
    if (error) throw error
    return data?.[0]
  },

  update: async (id: string, dish: any) => {
    const { data, error } = await supabase.from("dishes").update(dish).eq("id", id).select()
    if (error) throw error
    return data?.[0]
  },

  delete: async (id: string) => {
    const { error } = await supabase.from("dishes").delete().eq("id", id)
    if (error) throw error
    return true
  },
}

// Servicio para mesas
export const tableService = {
  async getAll() {
    const { data, error } = await supabase
      .from("tables")
      .select(`
  *,
  profiles(id, full_name)
`)
      .order("number")

    if (error) {
      log.error("Error al obtener mesas:", { error: String(error) })
      throw error
    }

    // Transformar los datos para incluir el nombre del mesero directamente
    const tablesWithWaiterNames =
      data?.map((table) => ({
        ...table,
        waiter_name: table.profiles ? table.profiles.full_name : null,
      })) || []

    return tablesWithWaiterNames
  },

  async getById(id: string) {
    const { data, error } = await supabase
      .from("tables")
      .select(`
        *,
        profiles(id, full_name)
      `)
      .eq("id", id)
      .single()

    if (error) {
      log.error("Error al obtener mesa por ID:", { error: String(error) })
      throw error
    }

    return {
      ...data,
      waiter_name: data.profiles ? data.profiles.full_name : null,
    }
  },

  async create(table: { number: number; status: string }) {
    try {
      log.info("Creando mesa con datos:", { table })

      const { data, error } = await supabase
        .from("tables")
        .insert({
          number: table.number,
          status: table.status || "available",
        })
        .select()

      if (error) {
        log.error("Error al crear mesa:", { error: String(error) })
        throw error
      }

      log.info("Mesa creada:", { data: data?.[0] })
      return data?.[0]
    } catch (error) {
      log.error("Error en create de mesas:", { error: String(error) })
      throw error
    }
  },

  async update(id: string, table: { number?: number; status?: string }) {
    const { data, error } = await supabase
      .from("tables")
      .update({
        ...table,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()

    if (error) {
      log.error("Error al actualizar mesa:", { error: String(error) })
      throw error
    }

    return data?.[0]
  },

  async delete(id: string) {
    try {
      log.info("Intentando eliminar mesa con ID:", { id })

      // Verificar si hay órdenes activas para esta mesa
      const { data: activeOrders, error: ordersError } = await supabase
        .from("orders")
        .select("id")
        .eq("table_id", id)
        .neq("status", "paid")

      if (ordersError) {
        log.error("Error al verificar órdenes activas:", { ordersError: String(ordersError) })
        throw ordersError
      }

      if (activeOrders && activeOrders.length > 0) {
        log.warn("No se puede eliminar la mesa porque tiene órdenes activas")
        throw new Error("No se puede eliminar una mesa con órdenes activas")
      }

      // Eliminar la mesa
      const { error } = await supabase.from("tables").delete().eq("id", id)

      if (error) {
        log.error("Error al eliminar mesa:", { error: String(error) })
        throw error
      }

      log.info("Mesa eliminada correctamente")
      return true
    } catch (error) {
      log.error("Error en delete de mesas:", { error: String(error) })
      throw error
    }
  },

  async getWaiters() {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, username, role")
      .eq("role", "waiter")
      .eq("active", true)

    if (error) {
      log.error("Error al obtener meseros:", { error: String(error) })
      throw error
    }

    // Convertir al formato que espera el store
    return (
      data.map((waiter) => ({
        id: waiter.id,
        name: waiter.full_name,
        username: waiter.username,
        role: waiter.role,
      })) || []
    )
  },

  // Modificar el método assignWaiter para aceptar un parámetro de estado
  async assignWaiter(tableId: string, waiterId: string, status = "reserved") {
    const { data, error } = await supabase
      .from("tables")
      .update({
        waiter_id: waiterId,
        status: status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", tableId)
      .select()

    if (error) {
      log.error("Error al asignar mesero a mesa:", { error: String(error) })
      throw error
    }

    return data?.[0]
  },

  async updateTableStatus(tableId: string, status: string) {
    // Si el estado es "available", también eliminamos el mesero asignado
    const updates: any = {
      status: status,
      updated_at: new Date().toISOString(),
    }

    // Si estamos liberando la mesa, eliminamos el mesero asignado
    if (status === "available") {
      updates["waiter_id"] = null
    }

    const { data, error } = await supabase.from("tables").update(updates).eq("id", tableId).select()

    if (error) {
      log.error("Error al actualizar estado de la mesa:", { error: String(error) })
      throw error
    }

    log.info(`Mesa ${tableId} actualizada a estado ${status}`, { data: data?.[0] })
    return data?.[0]
  },

  async releaseTable(tableId: string) {
    log.info(`Liberando mesa ${tableId}...`)
    const { data, error } = await supabase
      .from("tables")
      .update({
        waiter_id: null,
        status: "available",
        updated_at: new Date().toISOString(),
      })
      .eq("id", tableId)
      .select()

    if (error) {
      log.error("Error al liberar mesa:", { error: String(error) })
      throw error
    }

    log.info(`Mesa ${tableId} liberada correctamente`, { data: data?.[0] })
    return data?.[0]
  },
  // Añadir este método para actualizar el estado de una mesa
  updateStatus: async (tableId: string, status: string) => {
    try {
      const { data, error } = await supabase.from("tables").update({ status }).eq("id", tableId)

      if (error) throw error
      return data
    } catch (error) {
      log.error("Error al actualizar estado de mesa:", { error: String(error) })
      throw error
    }
  },
}

// Servicios para recetas
export const recipeService = {
  getByDishId: async (dishId: string) => {
    const { data, error } = await supabase.from("recipes").select("*").eq("dish_id", dishId).single()

    if (error) {
      // Si no existe la receta, devolvemos null en lugar de lanzar un error
      if (error.code === "PGRST116") {
        return null
      }
      throw error
    }

    return data
  },

  create: async (recipe: { dishId: string }) => {
    const { data, error } = await supabase
      .from("recipes")
      .insert([
        {
          dish_id: recipe.dishId,
          created_at: new Date().toISOString(),
        },
      ])
      .select()

    if (error) throw error
    return data?.[0]
  },

  getRecipeIngredients: async (recipeId: string) => {
    const { data, error } = await supabase
      .from("recipe_ingredients")
      .select(`
        *,
        ingredients (name, unit)
      `)
      .eq("recipe_id", recipeId)

    if (error) throw error

    // Procesamos los datos para un formato más fácil de usar
    return (data || []).map((item) => ({
      id: item.id,
      recipeId: item.recipe_id,
      ingredientId: item.ingredient_id,
      quantity: item.quantity,
      createdAt: item.created_at,
      ingredient: item.ingredients
        ? {
            name: item.ingredients.name,
            unit: item.ingredients.unit,
          }
        : undefined,
    }))
  },

  addIngredientToRecipe: async (recipeIngredient: { recipeId: string; ingredientId: string; quantity: number }) => {
    const { data, error } = await supabase
      .from("recipe_ingredients")
      .insert([
        {
          recipe_id: recipeIngredient.recipeId,
          ingredient_id: recipeIngredient.ingredientId,
          quantity: recipeIngredient.quantity,
          created_at: new Date().toISOString(),
        },
      ])
      .select()

    if (error) throw error
    return data?.[0]
  },

  updateRecipeIngredient: async (id: string, updates: { quantity: number }) => {
    const { data, error } = await supabase
      .from("recipe_ingredients")
      .update({
        quantity: updates.quantity,
      })
      .eq("id", id)
      .select()

    if (error) throw error
    return data?.[0]
  },

  removeIngredientFromRecipe: async (recipeIngredientId: string) => {
    const { error } = await supabase.from("recipe_ingredients").delete().eq("id", recipeIngredientId)

    if (error) throw error
    return true
  },

  deleteRecipe: async (recipeId: string) => {
    // Primero eliminamos todos los ingredientes de la receta
    const { error: ingredientsError } = await supabase.from("recipe_ingredients").delete().eq("recipe_id", recipeId)

    if (ingredientsError) throw ingredientsError

    // Luego eliminamos la receta
    const { error } = await supabase.from("recipes").delete().eq("id", recipeId)

    if (error) throw error
    return true
  },
}

// Servicios para meseros (profiles con role = 'waiter')
export const waiterService = {
  async getAll() {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, full_name, role")
        .eq("role", "waiter")
        .eq("active", true)
        .order("full_name")

      if (error) throw error
      return data || []
    } catch (error) {
      log.error("Error al obtener meseros:", { error: String(error) })
      throw error
    }
  },

  async getById(id: string) {
    const { data, error } = await supabase.from("profiles").select("*").eq("id", id).eq("role", "waiter").single()

    if (error) {
      log.error("Error al obtener mesero por ID:", { error: String(error) })
      throw error
    }

    return data
  },

  async create(waiter: {
    full_name: string
    username: string
    email: string | null
    password: string
    active: boolean
  }) {
    const { data, error } = await supabase
      .from("profiles")
      .insert({
        ...waiter,
        role: "waiter",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()

    if (error) {
      log.error("Error al crear mesero:", { error: String(error) })
      throw error
    }

    return data?.[0]
  },

  async update(
    id: string,
    waiter: { full_name?: string; username?: string; email?: string | null; password?: string; active?: boolean },
  ) {
    const { data, error } = await supabase
      .from("profiles")
      .update({
        ...waiter,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("role", "waiter")
      .select()

    if (error) {
      log.error("Error al actualizar mesero:", { error: String(error) })
      throw error
    }

    return data?.[0]
  },

  async delete(id: string) {
    const { error } = await supabase.from("profiles").delete().eq("id", id).eq("role", "waiter")

    if (error) {
      log.error("Error al eliminar mesero:", { error: String(error) })
      throw error
    }

    return true
  },
}

// Servicios para órdenes
export const orderService = {
  async create(order: {
    table_id: string
    waiter_id: string
    items: CartItem[]
    subtotal: number
    tax: number
    tax_percentage: number
    tip: number
    tip_percentage: number
    total: number
    status: string
    is_partial_order?: boolean
    parent_order_id?: string | null
  }) {

    // Primero creamos la orden
    const { data: orderData, error: orderError } = await supabase
      .from("orders")
      .insert({
        table_id: order.table_id,
        waiter_id: order.waiter_id,
        subtotal: order.subtotal,
        tax: order.tax,
        tax_percentage: order.tax_percentage,
        tip: order.tip,
        tip_percentage: order.tip_percentage,
        total: order.total,
        status: "kitchen", // Always set to kitchen when creating
        is_partial_order: order.is_partial_order || false,
        parent_order_id: order.parent_order_id || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()

    if (orderError) {
      log.error("Error al crear orden:", { orderError: String(orderError) })
      throw orderError
    }

    const orderId = orderData?.[0]?.id

    if (!orderId) {
      throw new Error("No se pudo obtener el ID de la orden creada")
    }

    log.info("Orden creada con ID:", { orderId })

    // Luego creamos los items de la orden
    const orderItems = order.items.map((item) => ({
      order_id: orderId,
      dish_id: item.id.includes("-") ? null : item.id, // Si el ID contiene un guión, es un ID temporal
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      comments: item.comments || null,
      status: "kitchen", // Set initial status to kitchen
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }))

    const { error: itemsError } = await supabase.from("order_items").insert(orderItems)

    if (itemsError) {
      log.error("Error al crear items de la orden:", { itemsError: String(itemsError) })
      // Intentamos eliminar la orden si hubo un error al crear los items
      await supabase.from("orders").delete().eq("id", orderId)
      throw itemsError
    }

    // Actualizar el estado de la mesa a "cooking"
    try {
      await tableService.updateTableStatus(order.table_id, "kitchen")
    } catch (error) {
      log.error("Error al actualizar estado de la mesa:", { error: String(error) })
      // No lanzamos el error para no interrumpir el flujo principal
    }

    return {
      id: orderId,
      ...order,
    }
  },

  async createPartialOrder(parentOrderId: string, items: CartItem[], bill: any) {
    try {
      // Primero obtenemos la orden padre
      const { data: parentOrder, error: parentError } = await supabase
        .from("orders")
        .select("*")
        .eq("id", parentOrderId)
        .single()

      if (parentError) {
        log.error("Error al obtener orden padre:", { parentError: String(parentError) })
        throw parentError
      }

      if (!parentOrder) {
        throw new Error("No se encontró la orden padre")
      }

      // Creamos la orden parcial
      const { data: partialOrder, error } = await supabase
        .from("orders")
        .insert({
          table_id: parentOrder.table_id,
          waiter_id: parentOrder.waiter_id,
          subtotal: bill.subtotal,
          tax: bill.tax,
          tax_percentage: bill.taxPercentage,
          tip: bill.tip,
          tip_percentage: bill.tipPercentage,
          total: bill.total,
          status: "active",
          is_partial_order: true,
          parent_order_id: parentOrderId,
        })
        .select()
        .single()

      if (error) throw error
      if (!partialOrder) throw new Error("No se pudo crear la orden parcial")

      // Insertar los items de la orden parcial
      const orderItems = items.map((item) => ({
        order_id: partialOrder.id,
        dish_id: item.id.includes("-") ? null : item.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        comments: item.comments || null,
      }))

      const { error: itemsError } = await supabase.from("order_items").insert(orderItems)
      if (itemsError) throw itemsError

      // Actualizar los items de la orden original
      // Obtener los items actuales de la orden original
      const { data: originalItems, error: originalItemsError } = await supabase
        .from("order_items")
        .select("*")
        .eq("order_id", parentOrderId)

      if (originalItemsError) throw originalItemsError
      if (!originalItems) throw new Error("No se encontraron los items de la orden original")

      // Para cada item en la orden parcial, reducir la cantidad en la orden original
      for (const partialItem of items) {
        // Buscar el item original que coincide con el nombre y comentarios
        const originalItem = originalItems.find(
          (item) =>
            item.name === partialItem.name &&
            ((item.comments === null && partialItem.comments === undefined) || item.comments === partialItem.comments),
        )

        if (originalItem) {
          // Si la cantidad es igual, eliminar el item
          if (originalItem.quantity === partialItem.quantity) {
            const { error: deleteError } = await supabase.from("order_items").delete().eq("id", originalItem.id)
            if (deleteError) throw deleteError
          } else {
            // Si la cantidad es menor, actualizar el item
            const { error: updateError } = await supabase
              .from("order_items")
              .update({ quantity: originalItem.quantity - partialItem.quantity })
              .eq("id", originalItem.id)

            if (updateError) throw updateError
          }
        }
      }

      // Recalcular el total de la orden original
      const { data: remainingItems, error: remainingError } = await supabase
        .from("order_items")
        .select("*")
        .eq("order_id", parentOrderId)

      if (remainingError) throw remainingError

      // Si no hay items restantes, establecer un array vacío
      const itemsArray = remainingItems || []

      // Calcular nuevo subtotal
      const newSubtotal = itemsArray.reduce((sum, item) => sum + item.price * item.quantity, 0)
      const newTax = Math.round(newSubtotal * (parentOrder.tax_percentage / 100))
      const newTip = Math.round(newSubtotal * (parentOrder.tip_percentage / 100))
      const newTotal = newSubtotal + newTax + newTip

      // Actualizar la orden original
      const { error: updateOrderError } = await supabase
        .from("orders")
        .update({
          subtotal: newSubtotal,
          tax: newTax,
          tip: newTip,
          total: newTotal,
        })
        .eq("id", parentOrderId)

      if (updateOrderError) throw updateOrderError

      return partialOrder
    } catch (error) {
      log.error("Error al crear orden parcial:", { error: String(error) })
      throw error
    }
  },

  async deletePartialOrder(orderId: string) {
    // Primero verificamos que sea una orden parcial
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .eq("is_partial_order", true)
      .single()

    if (orderError) {
      log.error("Error al verificar orden parcial:", { orderError: String(orderError) })
      throw orderError
    }

    if (!order) {
      throw new Error("La orden no es una orden parcial o no existe")
    }

    // Obtener la orden parcial con sus items
    const { data: partialOrder, error: partialError } = await supabase
      .from("orders")
      .select("*, order_items(*)")
      .eq("id", orderId)
      .single()

    if (partialError || !partialOrder) throw new Error("No se encontró la orden parcial")
    if (!partialOrder.is_partial_order) throw new Error("La orden no es parcial")
    if (!partialOrder.parent_order_id) throw new Error("La orden parcial no tiene orden padre")

    // Obtener la orden padre
    const { data: parentOrder, error: parentError } = await supabase
      .from("orders")
      .select("*, order_items(*)")
      .eq("id", partialOrder.parent_order_id)
      .single()

    if (parentError || !parentOrder) throw new Error("No se encontró la orden padre")

    // Devolver los items a la orden original
    for (const partialItem of partialOrder.order_items) {
      // Buscar si el item ya existe en la orden original
      const parentItem = parentOrder.order_items.find(
        (item) => item.name === partialItem.name && (item.comments || "") === (partialItem.comments || ""),
      )

      if (parentItem) {
        // Si existe, actualizar la cantidad
        const { error: updateError } = await supabase
          .from("order_items")
          .update({ quantity: parentItem.quantity + partialItem.quantity })
          .eq("id", parentItem.id)

        if (updateError) throw updateError
      } else {
        // Si no existe, crear un nuevo item
        const { error: insertError } = await supabase.from("order_items").insert({
          order_id: parentOrder.id,
          dish_id: partialItem.dish_id,
          name: partialItem.name,
          price: partialItem.price,
          quantity: partialItem.quantity,
          comments: partialItem.comments,
        })

        if (insertError) throw insertError
      }
    }

    // Recalcular el total de la orden original
    const { data: updatedItems, error: updatedError } = await supabase
      .from("order_items")
      .select("*")
      .eq("order_id", parentOrder.id)

    if (updatedError) throw updatedError
    if (!updatedItems) throw new Error("No se encontraron los items actualizados")

    // Calcular nuevo subtotal
    const newSubtotal = updatedItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
    const newTax = Math.round(newSubtotal * (parentOrder.tax_percentage / 100))
    const newTip = Math.round(newSubtotal * (parentOrder.tip_percentage / 100))
    const newTotal = newSubtotal + newTax + newTip

    // Actualizar la orden original
    const { error: updateOrderError } = await supabase
      .from("orders")
      .update({
        subtotal: newSubtotal,
        tax: newTax,
        tip: newTip,
        total: newTotal,
      })
      .eq("id", parentOrder.id)

    if (updateOrderError) throw updateOrderError

    // Eliminamos los items de la orden
    const { error: itemsError } = await supabase.from("order_items").delete().eq("order_id", orderId)

    if (itemsError) {
      log.error("Error al eliminar items de la orden parcial:", { itemsError: String(itemsError) })
      throw itemsError
    }

    // Eliminamos la orden
    const { error: orderDeleteError } = await supabase.from("orders").delete().eq("id", orderId)

    if (orderDeleteError) {
      log.error("Error al eliminar orden parcial:", { orderDeleteError: String(orderDeleteError) })
      throw orderDeleteError
    }

    return true
  },

  async getAll() {
    const { data, error } = await supabase
      .from("orders")
      .select(
        `
        *,
        order_items (*)
      `,
      )
      .order("created_at", { ascending: false })

    if (error) {
      log.error("Error al obtener órdenes:", { error: String(error) })
      throw error
    }

    return data || []
  },

  async getByTable(tableId: string) {
    const { data, error } = await supabase
      .from("orders")
      .select(
        `
        *,
        order_items (*)
      `,
      )
      .eq("table_id", tableId)
      .order("created_at", { ascending: false })

    if (error) {
      log.error("Error al obtener órdenes por mesa:", { error: String(error) })
      throw error
    }

    return data || []
  },

  async getByStatus(statuses: string | string[]) {
    // Convertir a array si es un string
    const statusArray = Array.isArray(statuses) ? statuses : [statuses]

    try {
      // Realizar la consulta a Supabase
      const { data, error } = await supabase
        .from("orders")
        .select(`*, order_items(*)`)
        .in("status", statusArray)
        .order("created_at", { ascending: false })

      if (error) {
        throw error
      }

      // Mostrar detalles de la primera orden si hay resultados
      if (data && data.length > 0) {
        log.info("Primera orden:", {
          id: data[0].id,
          table_id: data[0].table_id,
          waiter_id: data[0].waiter_id,
          status: data[0].status,
          items_count: data[0].order_items?.length || 0,
        })
      }

      return data || []
    } catch (error) {
      throw error
    }
  },

  async updateStatus(orderId: string, status: string) {
    const { data, error } = await supabase
      .from("orders")
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .select()

    if (error) {
      log.error("Error al actualizar estado de la orden:", { error: String(error) })
      throw error
    }

    // Si la orden se marca como entregada, actualizar el estado de la mesa
    if (status === "delivered") {
      try {
        const order = data[0]
        if (order && order.table_id) {
          await tableService.updateTableStatus(order.table_id, "served")
        }
      } catch (error) {
        log.error("Error al actualizar estado de la mesa:", { error: String(error) })
      }
    }

    // Si la orden se marca como pagada, actualizar el estado de la mesa
    if (status === "paid") {
      try {
        const order = data[0]
        if (order && order.table_id) {
          // Verificar si hay otras órdenes activas para esta mesa
          const { data: activeOrders, error: activeOrdersError } = await supabase
            .from("orders")
            .select("id")
            .eq("table_id", order.table_id)
            .neq("id", orderId)
            .neq("status", "paid")

          if (activeOrdersError) {
            log.error("Error al verificar órdenes activas:", { activeOrdersError: String(activeOrdersError) })
          } else if (!activeOrders || activeOrders.length === 0) {
            // Si no hay otras órdenes activas, liberar la mesa
            log.info(`No hay más órdenes activas para la mesa ${order.table_id}, liberando...`)
            await tableService.releaseTable(order.table_id)
          }
        }
      } catch (error) {
        log.error("Error al actualizar estado de la mesa:", { error: String(error) })
      }
    }

    return data?.[0]
  },

  // RPC wrapper for complete_payment (P3 atomic payment)
  async completePaymentRpc(orderId: string, paymentMethods: string[], cashRegisterId: string): Promise<any> {
    const { data, error } = await (supabase.rpc as any)("complete_payment", {
      p_order_id: orderId,
      p_payment_methods: paymentMethods,
      p_cash_register_id: cashRegisterId,
    })

    if (error) {
      log.error("Error in complete_payment RPC:", { error: String(error) })
      throw error
    }

    return data
  },

  // Deprecated: use completePaymentRpc instead.
  // This method is kept for backward compatibility during the migration window.
  async completePayment(orderId: string, paymentMethod: string, _cashReceived?: number, _cashChange?: number) {
    log.warn(
      "[deprecation] completePayment(orderId, paymentMethod) is deprecated. " +
      "Migrate to completePaymentRpc(orderId, paymentMethods[], cashRegisterId). " +
      "See docs/payment-atomicity-test.md for the RPC interface."
    )

    // Get the current register ID from the cash register store
    // (imported dynamically to avoid circular dependency)
    const { useCashRegisterStore } = await import("@/store/use-cash-register-store")
    const currentRegister = useCashRegisterStore.getState().currentRegister
    const registerId = currentRegister?.id ?? ""

    // Convert single paymentMethod to array format: 'method:amount'
    // The amount is derived from the order's bill_total_cents (server-side via RPC)
    const paymentMethods = [`${paymentMethod}:0`]

    const result = await this.completePaymentRpc(orderId, paymentMethods, registerId)

    if (result?.status === "already_paid") {
      return `INV-${orderId.substring(0, 8)}-repaid`
    }

    return `INV-${orderId.substring(0, 8)}`
  },

  async completePartialPayment(orderId: string, selectedItems: string[]) {
    return this.completePayment(orderId, "cash")
  },

  // RPC wrapper for delete_order_with_items (P3 atomic delete)
  async deleteOrderRpc(orderId: string) {
    const { error } = await (supabase.rpc as any)("delete_order_with_items", {
      p_order_id: orderId,
    })

    if (error) {
      log.error("Error in delete_order_with_items RPC:", { error: String(error) })
      throw error
    }

    return true
  },

  // Deprecated: use deleteOrderRpc instead.
  // This method is kept for backward compatibility during the migration window.
  async deleteOrder(orderId: string) {
    log.warn(
      "[deprecation] deleteOrder(orderId) is deprecated. " +
      "Migrate to deleteOrderRpc(orderId). " +
      "See docs/payment-atomicity-test.md for the RPC interface."
    )
    return this.deleteOrderRpc(orderId)
  },

  async getById(orderId: string) {
    try {
      const { data, error } = await supabase
        .from("orders")
        .select(`
        *,
        order_items (*)
      `)
        .eq("id", orderId)
        .single()

      if (error) {
        log.error("Error al obtener orden por ID:", { error: String(error) })
        throw error
      }

      return data
    } catch (error) {
      log.error("Error en getById de órdenes:", { error: String(error) })
      throw error
    }
  },

  addItemsToOrder: async (orderId: string, items: any[]) => {
    try {
      const { data, error } = await supabase.from("order_items").insert(items).select()

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      log.error("Error al añadir items a la orden:", { error: String(error) })
      return { data: null, error }
    }
  },

  recalculateOrderTotals: async (orderId: string) => {
    try {
      // Obtener todos los items de la orden
      const { data: items, error: itemsError } = await supabase.from("order_items").select("*").eq("order_id", orderId)

      if (itemsError) throw itemsError

      // Obtener la orden para conocer los porcentajes
      const { data: order, error: orderError } = await supabase.from("orders").select("*").eq("id", orderId).single()

      if (orderError) throw orderError

      // Calcular el nuevo subtotal
      const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0)

      // Calcular impuestos y propina
      const taxPercentage = order.tax_percentage
      const tipPercentage = order.tip_percentage
      const tax = Math.round(subtotal * (taxPercentage / 100))
      const tip = Math.round(subtotal * (tipPercentage / 100))
      const total = subtotal + tax + tip

      // Actualizar la orden
      const { error: updateError } = await supabase
        .from("orders")
        .update({
          subtotal,
          tax,
          tip,
          total,
          updated_at: new Date().toISOString(),
        })
        .eq("id", orderId)

      if (updateError) throw updateError

      return { success: true, error: null }
    } catch (error) {
      log.error("Error al recalcular totales de la orden:", { error: String(error) })
      return { success: false, error }
    }
  },
}

// Agregar esta función al archivo existente
export async function getOrdersByDate(date: Date): Promise<Order[]> {
  // Crear fechas para el inicio y fin del día
  const startOfDay = new Date(date)
  startOfDay.setHours(0, 0, 0, 0)

  const endOfDay = new Date(date)
  endOfDay.setHours(23, 59, 59, 999)

  // Formatear fechas para la consulta
  const startDate = startOfDay.toISOString()
  const endDate = endOfDay.toISOString()

  try {
    const { data, error } = await supabase
      .from("orders")
      .select(`
        *,
        order_items(*)
      `)
      .eq("status", "paid")
      .gte("created_at", startDate)
      .lte("created_at", endDate)

    if (error) {
      throw error
    }

    const orders = await Promise.all(
      data.map(async (order: any) => {
        const { data: payments, error: payError } = await supabase
          .from("payment_transactions")
          .select("method")
          .eq("order_id", order.id)

        if (payError) {
          log.error("Error al obtener métodos de pago:", { payError: String(payError) })
        }

        let paymentMethod: PaymentMethod | "multiple" | undefined
        if (payments && payments.length > 0) {
          const unique = Array.from(new Set(payments.map((p) => p.method)))
          paymentMethod = unique.length > 1 ? "multiple" : (unique[0] as PaymentMethod)
        }

        return {
          id: order.id,
          tableId: order.table_id,
          waiter: order.waiter_id,
          status: order.status,
          items: order.order_items || [],
          bill: {
            subtotal: order.subtotal || 0,
            tax: order.tax || 0,
            taxPercentage: order.tax_percentage || 0,
            tip: order.tip || 0,
            tipPercentage: order.tip_percentage || 0,
            total: order.total || 0,
          },
          subtotal: order.subtotal || 0,
          tax: order.tax || 0,
          taxPercentage: order.tax_percentage || 0,
          tip: order.tip || 0,
          tipPercentage: order.tip_percentage || 0,
          total: order.total || 0,
          createdAt: order.created_at,
          updatedAt: order.updated_at,
          paymentMethod,
        }
      })
    )

    return orders
  } catch (error) {
    throw error
  }
}

// Actualizar la exportación de services
export const services = {
  categories: categoryService,
  dishes: dishService,
  ingredients: ingredientService,
  ingredientCategories: ingredientCategoryService,
  waiters: waiterService,
  tables: tableService,
  orders: orderService,
  ingredientTransactions: ingredientTransactionService,
  recipes: recipeService,
}
