// types/models.ts

// // Definición de tipos para las entidades principales del sistema
//
// export interface Category {
//   id: number
//   name: string
//   description?: string
//   icon?: string
//   active: boolean
//   createdAt?: string
//   updatedAt?: string
// }
//
// export interface Dish {
//   id: string
//   name: string
//   description?: string
//   price: number
//   categoryId: number
//   image?: string
//   available: boolean
//   featured?: boolean
//   createdAt?: string
//   categories?: {
//     name: string
//   }
//   // Propiedades añadidas para la lógica de promociones
//   originalPrice?: number;
//   discountAmount?: number;
//   discountPercentage?: number;
//   promotionId?: string;
//   promotionName?: string;
// }
//
// export interface Table {
//   id: string
//   number: number
//   capacity: number
//   status: "available" | "occupied" | "reserved" | "maintenance"
//   location?: string
//   createdAt?: string
//   waiter_id?: string | null; // Añadido para el ID del mesero
//   profiles?: { // Para la relación con el perfil del mesero
//     id: string;
//     full_name: string;
//   } | null;
//   waiter_name?: string | null; // Para el nombre del mesero
// }
//
// export interface Profile { // Renombrado de Waiter a Profile para ser más genérico
//   id: string
//   username: string
//   full_name: string
//   email?: string
//   password?: string
//   active: boolean
//   role: "admin" | "waiter" | "cashier" | "kitchen" // Ejemplo de roles
//   created_at?: string // Usar created_at para consistencia con Supabase
//   updated_at?: string // Usar updated_at
// }
//
//
// export interface Order {
//   id: string // Cambiado a string para consistencia con IDs de Supabase
//   table_id: string // Usar table_id
//   waiter_id: string // Usar waiter_id
//   status: "pending" | "in-progress" | "completed" | "cancelled" | "delivered" | "paid" | "active"
//   subtotal: number;
//   tax: number;
//   tax_percentage: number;
//   tip: number;
//   tip_percentage: number;
//   total: number
//   total_discounts?: number; // Asegurarse que esté aquí
//   created_at: string // Usar created_at
//   updated_at?: string // Usar updated_at
//   table?: Table
//   waiter?: Profile // Relacionado con Profile
//   items?: OrderItem[] // En la BD se llama order_items
//   is_partial_order?: boolean;
//   parent_order_id?: string | null;
// }
//
// export interface OrderItem {
//   id: string // Cambiado a string
//   order_id: string // Usar order_id
//   dish_id: string | null // Puede ser null si es un item manual (ej. "propina")
//   quantity: number
//   price: number
//   status: "pending" | "in-progress" | "completed" | "cancelled" | "kitchen" | "served"
//   comments?: string // Renombrado de notes a comments para consistencia
//   created_at: string // Usar created_at
//   updated_at?: string // Usar updated_at
//   dish?: Dish
// }
//
// export interface Payment {
//   id: string // Cambiado a string
//   order_id: string // Usar order_id
//   amount: number
//   method: "cash" | "credit" | "debit" | "transfer" | "other"
//   status: "pending" | "completed" | "cancelled"
//   reference?: string
//   created_at: string // Usar created_at
// }
//
//
//
//
//
//
// export interface Promotion {
//   id: string // Cambiado a string
//   name: string
//   description: string | null
//   discount_type: "percentage" | "fixed_amount"
//   discount_value: number
//   start_date: string
//   end_date: string
//   active: boolean
//   created_at?: string
//   updated_at?: string
//   promotion_dishes?: { // Para las relaciones con platos
//     dish_id: string;
//     dishes?: {
//       name: string;
//     };
//   }[];
// }
//
// export interface CashRegister {
//   id: string // Cambiado a string
//   opened_at: string // Usar opened_at
//   closed_at?: string // Usar closed_at
//   initial_balance: number // Usar initial_balance
//   final_balance?: number // Usar final_balance
//   difference?: number
//   status: "open" | "closed"
//   opened_by_user_id: string // Usar opened_by_user_id
//   closed_by_user_id?: string // Usar closed_by_user_id
//   notes?: string
//   created_at?: string
//   updated_at?: string
// }
//
// export interface CashTransaction {
//   id: string // Cambiado a string
//   cash_register_id: string // Usar cash_register_id
//   amount: number
//   type: "income" | "expense"
//   category: "sale" | "refund" | "withdrawal" | "deposit" | "other"
//   description?: string
//   created_at: string // Usar created_at
//   user_id: string // Usar user_id (quién realizó la transacción)
// }
//
// export type BusinessConfigValues = {
//   tax_percentage: number
//   tip_percentage: number
//   price_suggestion: number
//   business_name: string
//   business_address: string
//   business_phone: string
//   business_nit: string
//   inventory_control_enabled: boolean
//   // Añadimos las contraseñas de los perfiles
//   kitchen_password: string
//   cashier_password: string
//   admin_password: string
//   waiter_password: string
//   [key: string]: string | number | boolean
// }
//
// // Tipo para un registro individual de configuración
// export type BusinessConfig = {
//   id: string
//   key: string
//   value: string
//   created_at?: string
//   updated_at?: string
// }
