// Definición de tipos para las entidades principales del sistema

export interface Category {
  id: number;
  name: string;
  description?: string;
  icon?: string;
  active: boolean;
  createdAt?: string;
}

export interface Dish {
  id: number;
  name: string;
  description?: string;
  price: number;
  categoryId: number;
  image_url?: string;
  available: boolean;
  featured?: boolean;
  createdAt?: string;
  categories?: {
    name: string;
  };
}

export interface Table {
  id: number;
  number: number;
  waiter_id: string | null;
  status: "available" | "occupied" | "reserved" | "maintenance";
  created_at?: string;
  updated_at?: string;
}

export interface Waiter {
  id: number;
  name: string;
  username: string;
  email?: string;
  phone?: string;
  active: boolean;
  pin?: string;
  createdAt?: string;
}

export interface Order {
  id: number;
  tableId: number;
  waiterId: number;
  status: "pending" | "in-progress" | "completed" | "cancelled";
  total: number;
  createdAt: string;
  updatedAt?: string;
  table?: Table;
  waiter?: Waiter;
  items?: OrderItem[];
}

export interface OrderItem {
  id: number;
  orderId: number;
  dishId: number;
  quantity: number;
  price: number;
  status: "pending" | "in-progress" | "completed" | "cancelled";
  notes?: string;
  createdAt: string;
  dish?: Dish;
}

export interface Payment {
  id: number;
  orderId: number;
  amount: number;
  method: "cash" | "credit" | "debit" | "transfer" | "other";
  status: "pending" | "completed" | "cancelled";
  reference?: string;
  createdAt: string;
}

export interface Ingredient {
  id: string;
  name: string;
  description?: string;
  unit: string;
  stock: number;
  minStock: number;
  cost?: number;
  categoryId?: number;
  createdAt?: string;
  category?: {
    name: string;
  };
}

export interface Recipe {
  id: number;
  dishId: number;
  ingredientId: number;
  quantity: number;
  dish?: Dish;
  ingredient?: Ingredient;
}

export interface IngredientTransaction {
  id: number;
  ingredientId: number;
  quantity: number;
  type: "purchase" | "adjustment" | "usage" | "waste";
  notes?: string;
  cost?: number;
  createdAt: string;
  ingredient?: Ingredient;
}

export interface CashRegister {
  id: number;
  openedAt: string;
  closedAt?: string;
  initialAmount: number;
  finalAmount?: number;
  difference?: number;
  status: "open" | "closed";
  openedBy: string;
  closedBy?: string;
  notes?: string;
}

export interface CashTransaction {
  id: number;
  registerId: number;
  amount: number;
  type: "income" | "expense";
  category: "sale" | "refund" | "withdrawal" | "deposit" | "other";
  description?: string;
  createdAt: string;
  createdBy: string;
}

export interface BusinessConfig {
  id: number;
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  taxRate?: number;
  currency?: string;
  logo?: string;
  receiptHeader?: string;
  receiptFooter?: string;
  updatedAt: string;
}
