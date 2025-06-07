import { supabase } from "@/lib/db/client"

interface IngredientTransaction {
  id?: string
  ingredient_id: string
  quantity: number
  total_cost: number
  unit_cost: number
  transaction_type: "entrada" | "salida" | "ajuste"
  payment_status: "pagado" | "pendiente" | "ajustado" | "eliminado"
  notes?: string
  created_at?: string
  updated_at?: string
}

const ingredientTransactionService = {
  async getAll() {
    try {
      const { data, error } = await supabase
        .from("ingredient_transactions")
        .select(`
          *,
          ingredients (name, unit)
        `)
        .order("created_at", { ascending: false })

      if (error) throw error

      // Procesar los datos para un formato más fácil de usar
      return (data || []).map((transaction) => ({
        ...transaction,
        ingredient_name: transaction.ingredients ? transaction.ingredients.name : "Desconocido",
        ingredient_unit: transaction.ingredients ? transaction.ingredients.unit : "",
      }))
    } catch (error) {
      console.error("Error al obtener transacciones de ingredientes:", error)
      throw error
    }
  },

  async getByIngredient(ingredientId: string) {
    try {
      const { data, error } = await supabase
        .from("ingredient_transactions")
        .select("*")
        .eq("ingredient_id", ingredientId)
        .order("created_at", { ascending: false })

      if (error) throw error
      return data || []
    } catch (error) {
      console.error(`Error al obtener transacciones para el ingrediente ${ingredientId}:`, error)
      throw error
    }
  },

  async create(transaction: IngredientTransaction) {
    try {
      console.log("Creando transacción de ingrediente:", transaction)

      // Asegurarse de que todos los campos requeridos estén presentes
      const now = new Date().toISOString()
      const transactionData = {
        ingredient_id: transaction.ingredient_id,
        quantity: Number(transaction.quantity),
        total_cost: Number(transaction.total_cost),
        unit_cost: Number(transaction.unit_cost || transaction.total_cost / transaction.quantity),
        transaction_type: transaction.transaction_type,
        payment_status: transaction.payment_status || "pagado",
        notes: transaction.notes || "",
        created_at: transaction.created_at || now,
        updated_at: transaction.updated_at || now,
      }

      const { data, error } = await supabase.from("ingredient_transactions").insert([transactionData]).select()

      if (error) {
        console.error("Error al crear transacción de ingrediente:", error)
        throw error
      }

      console.log("Transacción creada exitosamente:", data)
      return data?.[0]
    } catch (error) {
      console.error("Error en create de transacción de ingrediente:", error)
      throw error
    }
  },

  async delete(id: string) {
    try {
      const { error } = await supabase.from("ingredient_transactions").delete().eq("id", id)

      if (error) throw error
      return true
    } catch (error) {
      console.error(`Error al eliminar transacción ${id}:`, error)
      throw error
    }
  },
}

export default ingredientTransactionService
