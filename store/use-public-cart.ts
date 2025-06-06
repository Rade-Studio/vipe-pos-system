import { create } from "zustand"
import type { Dish } from "@/types"

export interface PublicCartItem {
  id: string
  name: string
  price: number
  quantity: number
}

interface PublicCartState {
  items: PublicCartItem[]
  add: (dish: Dish) => void
  update: (id: string, quantity: number) => void
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
          { id: dish.id, name: dish.name, price: dish.price, quantity: 1 },
        ],
      }
    }),
  update: (id, quantity) =>
    set((state) => ({
      items: state.items.map((i) =>
        i.id === id ? { ...i, quantity } : i,
      ),
    })),
  clear: () => set({ items: [] }),
}))
