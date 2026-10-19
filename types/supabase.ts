export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      business_config: {
        Row: {
          created_at: string | null
          id: string
          key: string
          restaurant_id: string
          updated_at: string | null
          value: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          key: string
          restaurant_id?: string
          updated_at?: string | null
          value: string
        }
        Update: {
          created_at?: string | null
          id?: string
          key?: string
          restaurant_id?: string
          updated_at?: string | null
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_config_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_registers: {
        Row: {
          closing_timestamp: string | null
          created_at: string | null
          final_cash: number | null
          id: string
          initial_cash: number
          opening_timestamp: string
          restaurant_id: string
          status: string
          updated_at: string | null
        }
        Insert: {
          closing_timestamp?: string | null
          created_at?: string | null
          final_cash?: number | null
          id?: string
          initial_cash: number
          opening_timestamp: string
          restaurant_id?: string
          status: string
          updated_at?: string | null
        }
        Update: {
          closing_timestamp?: string | null
          created_at?: string | null
          final_cash?: number | null
          id?: string
          initial_cash?: number
          opening_timestamp?: string
          restaurant_id?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_registers_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_transactions: {
        Row: {
          amount: number
          cash_register_id: string
          created_at: string | null
          description: string | null
          id: string
          restaurant_id: string
          timestamp: string
          type: string
          updated_at: string | null
        }
        Insert: {
          amount: number
          cash_register_id: string
          created_at?: string | null
          description?: string | null
          id?: string
          restaurant_id?: string
          timestamp?: string
          type: string
          updated_at?: string | null
        }
        Update: {
          amount?: number
          cash_register_id?: string
          created_at?: string | null
          description?: string | null
          id?: string
          restaurant_id?: string
          timestamp?: string
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_transactions_cash_register_id_fkey"
            columns: ["cash_register_id"]
            isOneToOne: false
            referencedRelation: "cash_registers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_transactions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          active: boolean
          created_at: string | null
          description: string | null
          icon: string
          id: string
          name: string
          restaurant_id: string
          updated_at: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string | null
          description?: string | null
          icon: string
          id?: string
          name: string
          restaurant_id?: string
          updated_at?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string | null
          description?: string | null
          icon?: string
          id?: string
          name?: string
          restaurant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      couriers: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          phone: string | null
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          phone?: string | null
          restaurant_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          phone?: string | null
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "couriers_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_addresses: {
        Row: {
          address_line: string
          created_at: string
          customer_id: string
          id: string
          is_default: boolean
          label: string | null
          neighborhood: string | null
          reference: string | null
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          address_line: string
          created_at?: string
          customer_id: string
          id?: string
          is_default?: boolean
          label?: string | null
          neighborhood?: string | null
          reference?: string | null
          restaurant_id?: string
          updated_at?: string
        }
        Update: {
          address_line?: string
          created_at?: string
          customer_id?: string
          id?: string
          is_default?: boolean
          label?: string | null
          neighborhood?: string | null
          reference?: string | null
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_addresses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_addresses_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          id: string
          name: string
          notes: string | null
          phone: string
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          phone: string
          restaurant_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          phone?: string
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      dishes: {
        Row: {
          active: boolean
          allow_comments: boolean
          category_id: string | null
          created_at: string | null
          description: string | null
          id: string
          image_url: string | null
          name: string
          price: number
          restaurant_id: string
          updated_at: string | null
        }
        Insert: {
          active?: boolean
          allow_comments?: boolean
          category_id?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          name: string
          price: number
          restaurant_id?: string
          updated_at?: string | null
        }
        Update: {
          active?: boolean
          allow_comments?: boolean
          category_id?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          name?: string
          price?: number
          restaurant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dishes_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dishes_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_categories: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          restaurant_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          restaurant_id?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          restaurant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_categories_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_transactions: {
        Row: {
          created_at: string | null
          id: string
          ingredient_id: string | null
          notes: string | null
          payment_status: string
          quantity: number
          restaurant_id: string
          total_cost: number
          transaction_type: string
          unit_cost: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          ingredient_id?: string | null
          notes?: string | null
          payment_status?: string
          quantity: number
          restaurant_id?: string
          total_cost: number
          transaction_type: string
          unit_cost: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          ingredient_id?: string | null
          notes?: string | null
          payment_status?: string
          quantity?: number
          restaurant_id?: string
          total_cost?: number
          transaction_type?: string
          unit_cost?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_transactions_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_transactions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_transactions_orders: {
        Row: {
          created_at: string
          id: string
          ingredient_transaction_id: string
          order_id: string
          quantity_cents: number
        }
        Insert: {
          created_at?: string
          id?: string
          ingredient_transaction_id: string
          order_id: string
          quantity_cents: number
        }
        Update: {
          created_at?: string
          id?: string
          ingredient_transaction_id?: string
          order_id?: string
          quantity_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_transactions_orders_ingredient_transaction_id_fkey"
            columns: ["ingredient_transaction_id"]
            isOneToOne: false
            referencedRelation: "ingredient_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_transactions_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredients: {
        Row: {
          barcode: string | null
          category_id: string | null
          cost: number | null
          created_at: string | null
          default_supplier_id: string | null
          description: string | null
          id: string
          is_active: boolean
          kind: string
          max_stock: number | null
          min_stock: number
          name: string
          purchase_factor: number
          purchase_unit: string | null
          restaurant_id: string
          shelf_life_days: number | null
          sku: string
          stock: number
          track_lots: boolean
          unit: string
          updated_at: string | null
        }
        Insert: {
          barcode?: string | null
          category_id?: string | null
          cost?: number | null
          created_at?: string | null
          default_supplier_id?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          max_stock?: number | null
          min_stock?: number
          name: string
          purchase_factor?: number
          purchase_unit?: string | null
          restaurant_id?: string
          shelf_life_days?: number | null
          sku?: string
          stock?: number
          track_lots?: boolean
          unit: string
          updated_at?: string | null
        }
        Update: {
          barcode?: string | null
          category_id?: string | null
          cost?: number | null
          created_at?: string | null
          default_supplier_id?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          max_stock?: number | null
          min_stock?: number
          name?: string
          purchase_factor?: number
          purchase_unit?: string | null
          restaurant_id?: string
          shelf_life_days?: number | null
          sku?: string
          stock?: number
          track_lots?: boolean
          unit?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ingredients_category_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "ingredient_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredients_default_supplier_id_fkey"
            columns: ["default_supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredients_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_count_lines: {
        Row: {
          count_id: string
          counted_quantity: number | null
          created_at: string
          expected_quantity: number
          id: string
          ingredient_id: string
          notes: string | null
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          count_id: string
          counted_quantity?: number | null
          created_at?: string
          expected_quantity?: number
          id?: string
          ingredient_id: string
          notes?: string | null
          restaurant_id?: string
          updated_at?: string
        }
        Update: {
          count_id?: string
          counted_quantity?: number | null
          created_at?: string
          expected_quantity?: number
          id?: string
          ingredient_id?: string
          notes?: string | null
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_count_lines_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "inventory_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_lines_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_lines_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_counts: {
        Row: {
          applied_at: string | null
          created_at: string
          created_by: string | null
          id: string
          location_id: string
          notes: string | null
          number: number
          restaurant_id: string
          status: string
          updated_at: string
        }
        Insert: {
          applied_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          location_id: string
          notes?: string | null
          number: number
          restaurant_id?: string
          status?: string
          updated_at?: string
        }
        Update: {
          applied_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string
          notes?: string | null
          number?: number
          restaurant_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_counts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_counts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_counts_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_locations: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          restaurant_id?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_locations_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_lots: {
        Row: {
          created_at: string
          expires_on: string | null
          id: string
          ingredient_id: string
          location_id: string
          lot_code: string | null
          quantity: number
          received_at: string
          restaurant_id: string
          unit_cost: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          expires_on?: string | null
          id?: string
          ingredient_id: string
          location_id: string
          lot_code?: string | null
          quantity?: number
          received_at?: string
          restaurant_id?: string
          unit_cost?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          expires_on?: string | null
          id?: string
          ingredient_id?: string
          location_id?: string
          lot_code?: string | null
          quantity?: number
          received_at?: string
          restaurant_id?: string
          unit_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_lots_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lots_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lots_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          ingredient_id: string
          location_id: string
          lot_id: string | null
          movement_type: string
          notes: string | null
          quantity: number
          reason: string | null
          reference_id: string | null
          reference_type: string | null
          restaurant_id: string
          total_cost: number
          unit_cost: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          ingredient_id: string
          location_id: string
          lot_id?: string | null
          movement_type: string
          notes?: string | null
          quantity: number
          reason?: string | null
          reference_id?: string | null
          reference_type?: string | null
          restaurant_id?: string
          total_cost?: number
          unit_cost?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          ingredient_id?: string
          location_id?: string
          lot_id?: string | null
          movement_type?: string
          notes?: string | null
          quantity?: number
          reason?: string | null
          reference_id?: string | null
          reference_type?: string | null
          restaurant_id?: string
          total_cost?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_deliveries: {
        Row: {
          address_line: string
          address_reference: string | null
          cancelled_at: string | null
          cash_change_for: number | null
          courier_id: string | null
          created_at: string
          customer_id: string
          customer_name: string
          customer_phone: string
          delivered_at: string | null
          delivery_fee: number
          delivery_status: string
          dispatched_at: string | null
          failed_at: string | null
          failure_reason: string | null
          neighborhood: string | null
          notes: string | null
          order_id: string
          payment_mode: string
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          address_line: string
          address_reference?: string | null
          cancelled_at?: string | null
          cash_change_for?: number | null
          courier_id?: string | null
          created_at?: string
          customer_id: string
          customer_name: string
          customer_phone: string
          delivered_at?: string | null
          delivery_fee?: number
          delivery_status?: string
          dispatched_at?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          neighborhood?: string | null
          notes?: string | null
          order_id: string
          payment_mode?: string
          restaurant_id?: string
          updated_at?: string
        }
        Update: {
          address_line?: string
          address_reference?: string | null
          cancelled_at?: string | null
          cash_change_for?: number | null
          courier_id?: string | null
          created_at?: string
          customer_id?: string
          customer_name?: string
          customer_phone?: string
          delivered_at?: string | null
          delivery_fee?: number
          delivery_status?: string
          dispatched_at?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          neighborhood?: string | null
          notes?: string | null
          order_id?: string
          payment_mode?: string
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_deliveries_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_deliveries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_deliveries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_deliveries_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          added_at: string | null
          comments: string | null
          created_at: string | null
          dish_id: string | null
          id: string
          name: string
          order_id: string | null
          price: number
          quantity: number
          restaurant_id: string
          status: string | null
          stock_consumed_at: string | null
          updated_at: string | null
        }
        Insert: {
          added_at?: string | null
          comments?: string | null
          created_at?: string | null
          dish_id?: string | null
          id?: string
          name: string
          order_id?: string | null
          price: number
          quantity: number
          restaurant_id?: string
          status?: string | null
          stock_consumed_at?: string | null
          updated_at?: string | null
        }
        Update: {
          added_at?: string | null
          comments?: string | null
          created_at?: string | null
          dish_id?: string | null
          id?: string
          name?: string
          order_id?: string | null
          price?: number
          quantity?: number
          restaurant_id?: string
          status?: string | null
          stock_consumed_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_dish_id_fkey"
            columns: ["dish_id"]
            isOneToOne: false
            referencedRelation: "dishes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string | null
          id: string
          is_partial_order: boolean
          items_json: Json | null
          order_type: string
          parent_order_id: string | null
          restaurant_id: string
          status: string
          subtotal: number
          table_id: string | null
          tax: number
          tax_percentage: number
          tip: number
          tip_percentage: number
          total: number
          total_discounts: number | null
          updated_at: string | null
          waiter_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_partial_order?: boolean
          items_json?: Json | null
          order_type?: string
          parent_order_id?: string | null
          restaurant_id?: string
          status?: string
          subtotal: number
          table_id?: string | null
          tax: number
          tax_percentage: number
          tip?: number
          tip_percentage?: number
          total: number
          total_discounts?: number | null
          updated_at?: string | null
          waiter_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_partial_order?: boolean
          items_json?: Json | null
          order_type?: string
          parent_order_id?: string | null
          restaurant_id?: string
          status?: string
          subtotal?: number
          table_id?: string | null
          tax?: number
          tax_percentage?: number
          tip?: number
          tip_percentage?: number
          total?: number
          total_discounts?: number | null
          updated_at?: string | null
          waiter_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_waiter_id_fkey"
            columns: ["waiter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          kind: string
          name: string
          restaurant_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind: string
          name: string
          restaurant_id?: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          name?: string
          restaurant_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_tenders: {
        Row: {
          amount: number
          cash_received: number | null
          id: string
          line_no: number
          method_code: string
          method_kind: string
          payment_id: string
          payment_method_id: string
          restaurant_id: string
        }
        Insert: {
          amount: number
          cash_received?: number | null
          id?: string
          line_no: number
          method_code: string
          method_kind: string
          payment_id: string
          payment_method_id: string
          restaurant_id?: string
        }
        Update: {
          amount?: number
          cash_received?: number | null
          id?: string
          line_no?: number
          method_code?: string
          method_kind?: string
          payment_id?: string
          payment_method_id?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_tenders_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_tenders_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_tenders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_transactions: {
        Row: {
          amount: number
          cash_change: number | null
          cash_received: number | null
          cash_register_id: string
          created_at: string | null
          id: string
          method: string
          order_id: string
          restaurant_id: string
          table_id: string | null
          timestamp: string
          tip_amount: number | null
          total_discounts: number | null
          updated_at: string | null
          waiter_id: string | null
        }
        Insert: {
          amount: number
          cash_change?: number | null
          cash_received?: number | null
          cash_register_id: string
          created_at?: string | null
          id?: string
          method: string
          order_id: string
          restaurant_id?: string
          table_id?: string | null
          timestamp: string
          tip_amount?: number | null
          total_discounts?: number | null
          updated_at?: string | null
          waiter_id?: string | null
        }
        Update: {
          amount?: number
          cash_change?: number | null
          cash_received?: number | null
          cash_register_id?: string
          created_at?: string | null
          id?: string
          method?: string
          order_id?: string
          restaurant_id?: string
          table_id?: string | null
          timestamp?: string
          tip_amount?: number | null
          total_discounts?: number | null
          updated_at?: string | null
          waiter_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_cash_register_id_fkey"
            columns: ["cash_register_id"]
            isOneToOne: false
            referencedRelation: "cash_registers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_waiter_id_fkey"
            columns: ["waiter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_due: number
          cash_register_id: string
          cashier_profile_id: string | null
          change_given: number
          created_at: string
          id: string
          idempotency_key: string
          order_id: string
          restaurant_id: string
          tip_amount: number
          total_charged: number
        }
        Insert: {
          amount_due: number
          cash_register_id: string
          cashier_profile_id?: string | null
          change_given?: number
          created_at?: string
          id?: string
          idempotency_key: string
          order_id: string
          restaurant_id?: string
          tip_amount?: number
          total_charged: number
        }
        Update: {
          amount_due?: number
          cash_register_id?: string
          cashier_profile_id?: string | null
          change_given?: number
          created_at?: string
          id?: string
          idempotency_key?: string
          order_id?: string
          restaurant_id?: string
          tip_amount?: number
          total_charged?: number
        }
        Relationships: [
          {
            foreignKeyName: "payments_cash_register_id_fkey"
            columns: ["cash_register_id"]
            isOneToOne: false
            referencedRelation: "cash_registers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_cashier_profile_id_fkey"
            columns: ["cashier_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      production_batches: {
        Row: {
          created_at: string
          created_by: string | null
          expires_on: string | null
          id: string
          ingredient_id: string
          location_id: string
          lot_id: string | null
          notes: string | null
          quantity: number
          restaurant_id: string
          total_cost: number
          unit_cost: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_on?: string | null
          id?: string
          ingredient_id: string
          location_id: string
          lot_id?: string | null
          notes?: string | null
          quantity: number
          restaurant_id?: string
          total_cost?: number
          unit_cost?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_on?: string | null
          id?: string
          ingredient_id?: string
          location_id?: string
          lot_id?: string | null
          notes?: string | null
          quantity?: number
          restaurant_id?: string
          total_cost?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "production_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batches_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batches_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batches_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batches_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          auth_user_id: string | null
          created_at: string | null
          email: string | null
          full_name: string
          id: string
          restaurant_id: string
          role: string
          updated_at: string | null
          username: string | null
        }
        Insert: {
          active?: boolean
          auth_user_id?: string | null
          created_at?: string | null
          email?: string | null
          full_name: string
          id?: string
          restaurant_id?: string
          role: string
          updated_at?: string | null
          username?: string | null
        }
        Update: {
          active?: boolean
          auth_user_id?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string
          id?: string
          restaurant_id?: string
          role?: string
          updated_at?: string | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      promotion_dishes: {
        Row: {
          created_at: string | null
          dish_id: string
          id: string
          promotion_id: string
          restaurant_id: string
        }
        Insert: {
          created_at?: string | null
          dish_id: string
          id?: string
          promotion_id: string
          restaurant_id?: string
        }
        Update: {
          created_at?: string | null
          dish_id?: string
          id?: string
          promotion_id?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotion_dishes_dish_id_fkey"
            columns: ["dish_id"]
            isOneToOne: false
            referencedRelation: "dishes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_dishes_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_dishes_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      promotions: {
        Row: {
          active: boolean | null
          created_at: string | null
          description: string | null
          discount_type: string
          discount_value: number
          end_date: string
          id: string
          name: string
          restaurant_id: string
          start_date: string
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          description?: string | null
          discount_type: string
          discount_value: number
          end_date: string
          id?: string
          name: string
          restaurant_id?: string
          start_date: string
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          description?: string | null
          discount_type?: string
          discount_value?: number
          end_date?: string
          id?: string
          name?: string
          restaurant_id?: string
          start_date?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "promotions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_lines: {
        Row: {
          created_at: string
          id: string
          ingredient_id: string
          purchase_order_id: string
          quantity: number
          received_quantity: number
          restaurant_id: string
          unit_cost: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          ingredient_id: string
          purchase_order_id: string
          quantity: number
          received_quantity?: number
          restaurant_id?: string
          unit_cost?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          ingredient_id?: string
          purchase_order_id?: string
          quantity?: number
          received_quantity?: number
          restaurant_id?: string
          unit_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_lines_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_lines_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_lines_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          created_at: string
          created_by: string | null
          expected_on: string | null
          id: string
          location_id: string
          notes: string | null
          number: number
          ordered_at: string | null
          payment_status: string
          received_at: string | null
          restaurant_id: string
          status: string
          supplier_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expected_on?: string | null
          id?: string
          location_id: string
          notes?: string | null
          number: number
          ordered_at?: string | null
          payment_status?: string
          received_at?: string | null
          restaurant_id?: string
          status?: string
          supplier_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expected_on?: string | null
          id?: string
          location_id?: string
          notes?: string | null
          number?: number
          ordered_at?: string | null
          payment_status?: string
          received_at?: string | null
          restaurant_id?: string
          status?: string
          supplier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_ingredients: {
        Row: {
          created_at: string | null
          id: string
          ingredient_id: string
          quantity: number
          recipe_id: string
          restaurant_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          ingredient_id: string
          quantity: number
          recipe_id: string
          restaurant_id?: string
        }
        Update: {
          created_at?: string | null
          id?: string
          ingredient_id?: string
          quantity?: number
          recipe_id?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_ingredients_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_ingredients_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_ingredients_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          created_at: string | null
          dish_id: string | null
          id: string
          ingredient_id: string | null
          notes: string | null
          restaurant_id: string
          updated_at: string
          yield_quantity: number
        }
        Insert: {
          created_at?: string | null
          dish_id?: string | null
          id?: string
          ingredient_id?: string | null
          notes?: string | null
          restaurant_id?: string
          updated_at?: string
          yield_quantity?: number
        }
        Update: {
          created_at?: string | null
          dish_id?: string | null
          id?: string
          ingredient_id?: string | null
          notes?: string | null
          restaurant_id?: string
          updated_at?: string
          yield_quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "recipes_dish_id_fkey"
            columns: ["dish_id"]
            isOneToOne: true
            referencedRelation: "dishes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: true
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurants: {
        Row: {
          created_at: string
          currency: string
          id: string
          name: string
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          name: string
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          name?: string
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          contact_name: string | null
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          lead_time_days: number | null
          name: string
          notes: string | null
          phone: string | null
          restaurant_id: string
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          lead_time_days?: number | null
          name: string
          notes?: string | null
          phone?: string | null
          restaurant_id?: string
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          lead_time_days?: number | null
          name?: string
          notes?: string | null
          phone?: string | null
          restaurant_id?: string
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      tables: {
        Row: {
          created_at: string | null
          id: string
          number: number
          restaurant_id: string
          status: string
          updated_at: string | null
          waiter_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          number: number
          restaurant_id?: string
          status?: string
          updated_at?: string | null
          waiter_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          number?: number
          restaurant_id?: string
          status?: string
          updated_at?: string | null
          waiter_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tables_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tables_waiter_id_fkey"
            columns: ["waiter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_inventory_count: { Args: { p_count_id: string }; Returns: Json }
      check_dishes_stock: { Args: { p_items: Json }; Returns: Json }
      close_register: { Args: { p_cash_register_id: string }; Returns: Json }
      consume_order_stock: { Args: { p_order_id: string }; Returns: Json }
      create_delivery_order: {
        Args: {
          p_address: Json
          p_cash_change_for?: number
          p_customer: Json
          p_delivery_fee: number
          p_items: Json
          p_notes?: string
          p_payment_mode: string
        }
        Returns: Json
      }
      delete_order_with_items: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      inventory_adjust: {
        Args: {
          p_expires_on?: string
          p_ingredient_id: string
          p_location_id: string
          p_lot_code?: string
          p_lot_id?: string
          p_movement_type: string
          p_notes?: string
          p_quantity: number
          p_reason?: string
          p_unit_cost?: number
        }
        Returns: Json
      }
      inventory_overview: { Args: { p_days?: number }; Returns: Json }
      inventory_transfer: {
        Args: {
          p_from_location_id: string
          p_ingredient_id: string
          p_notes?: string
          p_quantity: number
          p_to_location_id: string
        }
        Returns: Json
      }
      open_inventory_count: {
        Args: {
          p_ingredient_ids?: string[]
          p_location_id?: string
          p_notes?: string
        }
        Returns: Json
      }
      pay_order: {
        Args: {
          p_cash_register_id: string
          p_idempotency_key: string
          p_order_id: string
          p_tenders: Json
          p_tip_amount: number
        }
        Returns: Json
      }
      produce_preparation: {
        Args: {
          p_ingredient_id: string
          p_location_id?: string
          p_lot_code?: string
          p_notes?: string
          p_quantity: number
        }
        Returns: Json
      }
      receive_purchase_order: {
        Args: { p_lines: Json; p_purchase_order_id: string }
        Returns: Json
      }
      register_summary: {
        Args: { p_cash_register_ids: string[] }
        Returns: Json
      }
      save_formula: {
        Args: {
          p_lines: Json
          p_notes?: string
          p_target_id: string
          p_target_type: string
          p_yield_quantity: number
        }
        Returns: Json
      }
      set_delivery_status: {
        Args: {
          p_action: string
          p_courier_id?: string
          p_order_id: string
          p_reason?: string
        }
        Returns: Json
      }
      split_order: {
        Args: { p_items: Json; p_parent_order_id: string }
        Returns: Json
      }
      undo_split: { Args: { p_child_order_id: string }; Returns: Json }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
