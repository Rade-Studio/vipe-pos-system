import { supabase } from "@/lib/supabase"
import type { Category, Dish, Table, Waiter } from "@/types/models"

// Servicio para categorías
export const categoryService = {
  getAll: async (): Promise<Category[]> => {
    const { data, error } = await supabase.from("categories").select("*").order("name")

    if (error) {
      console.error("Error fetching categories:", error)
      throw error
    }

    return data || []
  },

  getById: async (id: number): Promise<Category | null> => {
    const { data, error } = await supabase.from("categories").select("*").eq("id", id).single()

    if (error) {
      console.error(`Error fetching category with id ${id}:`, error)
      throw error
    }

    return data
  },

  create: async (category: Omit<Category, "id" | "createdAt">): Promise<Category> => {
    const { data, error } = await supabase.from("categories").insert([category]).select().single()

    if (error) {
      console.error("Error creating category:", error)
      throw error
    }

    return data
  },

  update: async (id: number, category: Partial<Category>): Promise<void> => {
    const { error } = await supabase.from("categories").update(category).eq("id", id)

    if (error) {
      console.error(`Error updating category with id ${id}:`, error)
      throw error
    }
  },

  delete: async (id: number): Promise<void> => {
    const { error } = await supabase.from("categories").delete().eq("id", id)

    if (error) {
      console.error(`Error deleting category with id ${id}:`, error)
      throw error
    }
  },
}

// Servicio para platos
export const dishService = {
  getAll: async (): Promise<Dish[]> => {
    const { data, error } = await supabase.from("dishes").select("*, categories(name)").order("name")

    if (error) {
      console.error("Error fetching dishes:", error)
      throw error
    }

    return data || []
  },

  getByCategory: async (categoryId: number): Promise<Dish[]> => {
    const { data, error } = await supabase.from("dishes").select("*").eq("categoryId", categoryId).order("name")

    if (error) {
      console.error(`Error fetching dishes for category ${categoryId}:`, error)
      throw error
    }

    return data || []
  },

  getById: async (id: number): Promise<Dish | null> => {
    const { data, error } = await supabase.from("dishes").select("*").eq("id", id).single()

    if (error) {
      console.error(`Error fetching dish with id ${id}:`, error)
      throw error
    }

    return data
  },

  create: async (dish: Omit<Dish, "id" | "createdAt">): Promise<Dish> => {
    const { data, error } = await supabase.from("dishes").insert([dish]).select().single()

    if (error) {
      console.error("Error creating dish:", error)
      throw error
    }

    return data
  },

  update: async (id: number, dish: Partial<Dish>): Promise<void> => {
    const { error } = await supabase.from("dishes").update(dish).eq("id", id)

    if (error) {
      console.error(`Error updating dish with id ${id}:`, error)
      throw error
    }
  },

  delete: async (id: number): Promise<void> => {
    const { error } = await supabase.from("dishes").delete().eq("id", id)

    if (error) {
      console.error(`Error deleting dish with id ${id}:`, error)
      throw error
    }
  },
}

// Servicio para mesas
export const tableService = {
  getAll: async (): Promise<Table[]> => {
    const { data, error } = await supabase.from("tables").select("*").order("number")

    if (error) {
      console.error("Error fetching tables:", error)
      throw error
    }

    return data || []
  },

  getById: async (id: number): Promise<Table | null> => {
    const { data, error } = await supabase.from("tables").select("*").eq("id", id).single()

    if (error) {
      console.error(`Error fetching table with id ${id}:`, error)
      throw error
    }

    return data
  },

  create: async (table: Omit<Table, "id" | "created_at">): Promise<Table> => {
    const { data, error } = await supabase.from("tables").insert([table]).select().single()

    if (error) {
      console.error("Error creating table:", error)
      throw error
    }

    return data
  },

  update: async (id: string, table: Partial<Table>): Promise<void> => {
    const { error } = await supabase.from("tables").update(table).eq("id", id)

    if (error) {
      console.error(`Error updating table with id ${id}:`, error)
      throw error
    }
  },

  delete: async (id: number): Promise<void> => {
    const { error } = await supabase.from("tables").delete().eq("id", id)

    if (error) {
      console.error(`Error deleting table with id ${id}:`, error)
      throw error
    }
  },
}

// Servicio para meseros
export const waiterService = {
  getAll: async (): Promise<Waiter[]> => {
    const { data, error } = await supabase.from("waiters").select("*").order("name")

    if (error) {
      console.error("Error fetching waiters:", error)
      throw error
    }

    return data || []
  },

  getById: async (id: number): Promise<Waiter | null> => {
    const { data, error } = await supabase.from("waiters").select("*").eq("id", id).single()

    if (error) {
      console.error(`Error fetching waiter with id ${id}:`, error)
      throw error
    }

    return data
  },

  create: async (waiter: Omit<Waiter, "id" | "createdAt">): Promise<Waiter> => {
    const { data, error } = await supabase.from("waiters").insert([waiter]).select().single()

    if (error) {
      console.error("Error creating waiter:", error)
      throw error
    }

    return data
  },

  update: async (id: number, waiter: Partial<Waiter>): Promise<void> => {
    const { error } = await supabase.from("waiters").update(waiter).eq("id", id)

    if (error) {
      console.error(`Error updating waiter with id ${id}:`, error)
      throw error
    }
  },

  delete: async (id: number): Promise<void> => {
    const { error } = await supabase.from("waiters").delete().eq("id", id)

    if (error) {
      console.error(`Error deleting waiter with id ${id}:`, error)
      throw error
    }
  },
}
