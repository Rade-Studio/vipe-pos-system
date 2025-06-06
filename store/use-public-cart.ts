import { create } from "zustand"
import type { Dish } from "@/types"

export interface PublicCartItem {
  id: string
  name: string
  price: number
  quantity: number
  comment: string
}

interface PublicCartState {
  items: PublicCartItem[]
  add: (dish: Dish) => void
  update: (id: string, quantity: number, comment?: string) => void
  remove: (id: string) => void
  clear: () => void
}

export const usePublicCart = create<PublicCartState>((set) => ({
  items: [],
  add: (dish) =>
    set((state) => {
      const existing = state.items.find((i) => i.id === dish.id)
      if (existing) {
        return {
          items: state.items.map((i) =>
            i.id === dish.id ? { ...i, quantity: i.quantity + 1 } : i,
          ),
        }
      }
      return {
        items: [
          ...state.items,
          { id: dish.id, name: dish.name, price: dish.price, quantity: 1, comment: "" },
        ],
      }
    }),
  update: (id, quantity, comment) =>
    set((state) => ({
      items: state.items.map((i) =>
        i.id === id ? { ...i, quantity, comment: comment ?? i.comment } : i,
      ),
    })),
  remove: (id) =>
    set((state) => ({
      items: state.items.filter((i) => i.id !== id),
    })),
  clear: () => set({ items: [] }),
}))
