import { create } from "zustand"
import type { Category, Dish } from "@/types"

interface MenuState {
  categories: Category[]
  dishes: Dish[]
  setCategories: (categories: Category[]) => void
  setDishes: (dishes: Dish[]) => void
}

export const useMenuStore = create<MenuState>((set) => ({
  categories: [],
  dishes: [],

  setCategories: (categories) => set({ categories }),
  setDishes: (dishes) => set({ dishes }),
}))
