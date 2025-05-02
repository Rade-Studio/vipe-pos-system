export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      invoices: {
        Row: {
          id: string
          invoice_number: string
          date: string
          table_id: string
          table_number: number
          waiter_id: string
          waiter_name: string
          payment_method: string
          subtotal: number
          tax: number
          tax_percentage: number
          tip: number
          tip_percentage: number
          total: number
          items: Json
          business_info: Json
          created_at: string
        }
        Insert: {
          id?: string
          invoice_number: string
          date: string
          table_id: string
          table_number: number
          waiter_id: string
          waiter_name: string
          payment_method: string
          subtotal: number
          tax: number
          tax_percentage: number
          tip: number
          tip_percentage: number
          total: number
          items: Json
          business_info: Json
          created_at?: string
        }
        Update: {
          id?: string
          invoice_number?: string
          date?: string
          table_id?: string
          table_number?: number
          waiter_id?: string
          waiter_name?: string
          payment_method?: string
          subtotal?: number
          tax?: number
          tax_percentage?: number
          tip?: number
          tip_percentage?: number
          total?: number
          items?: Json
          business_info?: Json
          created_at?: string
        }
      }
      categories: {
        Row: {
          id: string
          name: string
          icon: string
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          icon: string
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          icon?: string
          created_at?: string
        }
      }
      dishes: {
        Row: {
          id: string
          name: string
          description: string
          price: number
          category_id: string
          image_url: string
          available: boolean
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          description: string
          price: number
          category_id: string
          image_url?: string
          available?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string
          price?: number
          category_id?: string
          image_url?: string
          available?: boolean
          created_at?: string
        }
      }
      ingredient_categories: {
        Row: {
          id: string
          name: string
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          created_at?: string
        }
      }
      ingredients: {
        Row: {
          id: string
          name: string
          description: string
          unit: string
          stock: number
          min_stock: number
          category_id: string
          cost: number
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          description: string
          unit: string
          stock: number
          min_stock: number
          category_id: string
          cost: number
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string
          unit?: string
          stock?: number
          min_stock?: number
          category_id?: string
          cost?: number
          created_at?: string
        }
      }
      recipes: {
        Row: {
          id: string
          dish_id: string
          created_at: string
        }
        Insert: {
          id?: string
          dish_id: string
          created_at?: string
        }
        Update: {
          id?: string
          dish_id?: string
          created_at?: string
        }
      }
      recipe_ingredients: {
        Row: {
          id: string
          recipe_id: string
          ingredient_id: string
          quantity: number
          created_at: string
        }
        Insert: {
          id?: string
          recipe_id: string
          ingredient_id: string
          quantity: number
          created_at?: string
        }
        Update: {
          id?: string
          recipe_id?: string
          ingredient_id?: string
          quantity?: number
          created_at?: string
        }
      }
      waiters: {
        Row: {
          id: string
          name: string
          pin: string
          active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          pin: string
          active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          pin?: string
          active?: boolean
          created_at?: string
        }
      }
      users: {
        Row: {
          id: string
          name: string
          role: string
          pin: string
          active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          role: string
          pin: string
          active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          role?: string
          pin?: string
          active?: boolean
          created_at?: string
        }
      }
      cash_registers: {
        Row: {
          id: string
          opening_timestamp: string
          closing_timestamp: string | null
          initial_cash: number
          final_cash: number
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          opening_timestamp: string
          closing_timestamp?: string | null
          initial_cash: number
          final_cash?: number
          status: string
          created_at?: string
        }
        Update: {
          id?: string
          opening_timestamp?: string
          closing_timestamp?: string | null
          initial_cash?: number
          final_cash?: number
          status?: string
          created_at?: string
        }
      }
      transactions: {
        Row: {
          id: string
          cash_register_id: string
          order_id: string
          table_id: string
          amount: number
          method: string
          cash_received: number | null
          cash_change: number | null
          timestamp: string
          created_at: string
        }
        Insert: {
          id?: string
          cash_register_id: string
          order_id: string
          table_id: string
          amount: number
          method: string
          cash_received?: number | null
          cash_change?: number | null
          timestamp: string
          created_at?: string
        }
        Update: {
          id?: string
          cash_register_id?: string
          order_id?: string
          table_id?: string
          amount?: number
          method?: string
          cash_received?: number | null
          cash_change?: number | null
          timestamp?: string
          created_at?: string
        }
      }
      tables: {
        Row: {
          id: string
          number: number
          status: string
          waiter_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          number: number
          status: string
          waiter_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          number?: number
          status?: string
          waiter_id?: string | null
          created_at?: string
        }
      }
      orders: {
        Row: {
          id: string
          table_id: string
          waiter_id: string
          status: string
          items: Json
          subtotal: number
          tax: number
          tax_percentage: number
          tip: number
          tip_percentage: number
          total: number
          is_partial_order: boolean
          parent_order_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          table_id: string
          waiter_id: string
          status: string
          items: Json
          subtotal: number
          tax: number
          tax_percentage: number
          tip: number
          tip_percentage: number
          total: number
          is_partial_order?: boolean
          parent_order_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          table_id?: string
          waiter_id?: string
          status?: string
          items?: Json
          subtotal?: number
          tax?: number
          tax_percentage?: number
          tip?: number
          tip_percentage?: number
          total?: number
          is_partial_order?: boolean
          parent_order_id?: string | null
          created_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}
