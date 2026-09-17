import { create } from "zustand"
import { v4 as uuidv4 } from "uuid"
import type { CartItem, OrderBill } from "@/types"

interface CartState {
  cartItems: Record<string, CartItem[]>
  addToCart: (tableId: string, item: CartItem) => void
  updateQuantity: (tableId: string, itemId: string, quantity: number) => void
  updateItemComments: (tableId: string, itemId: string, comments: string) => void
  removeFromCart: (tableId: string, itemId: string) => void
  clearCart: (tableId: string) => void
  getCartByTable: (tableId: string) => CartItem[]
  getCartTotal: (tableId: string) => number
  calculateOrderBill: (items: CartItem[], tipPercentage?: number, taxPercentage?: number) => OrderBill
}

export const useCartStore = create<CartState>((set, get) => ({
  cartItems: {},

  addToCart: (tableId, newItem) =>
    set((state) => {
      const tableCart = state.cartItems[tableId] || []

      const existingItemIndex = tableCart.findIndex((item) => {
        const itemBaseId = item.id.includes("-") ? item.id.split("-")[0] : item.id
        const newItemBaseId = newItem.id.includes("-") ? newItem.id.split("-")[0] : newItem.id

        return (
          itemBaseId === newItemBaseId &&
          (item.comments === newItem.comments || (!item.comments && !newItem.comments))
        )
      })

      if (existingItemIndex !== -1) {
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
        return {
          cartItems: {
            ...state.cartItems,
            [tableId]: [...tableCart, { ...newItem, id: `${newItem.id}-${uuidv4()}` }],
          },
        }
      }
    }),

  updateQuantity: (tableId, itemId, quantity) =>
    set((state) => {
      const tableCart = state.cartItems[tableId] || []
      if (quantity <= 0) {
        return {
          cartItems: {
            ...state.cartItems,
            [tableId]: tableCart.filter((item) => item.id !== itemId),
          },
        }
      }
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

  calculateOrderBill: (items, tipPercentage = 10, taxPercentage = 8): OrderBill => {
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0)

    const totalDiscounts = items.reduce((sum, item) => {
      if (item.originalPrice && item.originalPrice > item.price) {
        return sum + (item.originalPrice - item.price) * item.quantity
      }
      return sum
    }, 0)

    const tax = Math.round(subtotal * (taxPercentage / 100))
    const tip = Math.round(subtotal * (tipPercentage / 100))
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
}))
