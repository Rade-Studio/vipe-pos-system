import { act, fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"

import type { Dish } from "@/types"

/**
 * T6 (S1/S2) — the grid used to run `checkStockForDish` once per dish (three
 * reads each: ~30 requests for a 10-dish category) and, while that ran, it
 * replaced the whole grid with skeletons. Now one batched read covers the whole
 * grid and the dishes stay on screen while it resolves.
 */

const env = vi.hoisted(() => ({
  checkStockForDishes: vi.fn(),
  checkStockForDish: vi.fn(),
}))

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    auth: { signOut: vi.fn() },
    from: () => {
      throw new Error("the grid must not read the database directly")
    },
  },
}))

vi.mock("@/lib/supabase/inventory-control-service", () => ({
  default: {
    // The T6 entry point: one read per category/menu.
    checkStockForDishes: env.checkStockForDishes,
    // Kept as a spy: if the grid still used the per-dish path, the suite would
    // see N calls instead of one.
    checkStockForDish: env.checkStockForDish,
  },
}))

import { DishGrid } from "./DishGrid"
import { useConfigStore } from "@/store/use-config-store"

const dish = (id: string, name: string, extra: Partial<Dish> = {}): Dish =>
  ({
    id,
    name,
    price: 12000,
    categoryId: "cat-1",
    image: "/dish.png",
    discountPercentage: null,
    discountAmount: null,
    originalPrice: 12000,
    promotionName: "",
    ...extra,
  }) as Dish

const dishes = [dish("d-1", "Bandeja"), dish("d-2", "Sopa"), dish("d-3", "Limonada")]

function renderGrid(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
  }
}

const skeletonCount = (container: HTMLElement) => container.querySelectorAll(".animate-pulse").length

/** Drains the stock read and lets React Query notify before asserting. */
const flush = async () => {
  for (let tick = 0; tick < 3; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

beforeEach(() => {
  env.checkStockForDishes.mockReset()
  env.checkStockForDish.mockReset()
  useConfigStore.setState({ inventoryControlEnabled: true })
})

describe("DishGrid — batched stock check (T6/S1)", () => {
  it("reads stock once for the whole grid instead of once per dish", async () => {
    env.checkStockForDishes.mockResolvedValue(new Map([["d-1", true]]))
    renderGrid(<DishGrid dishes={dishes} onAddToCart={() => {}} />)

    await flush()

    expect(env.checkStockForDishes).toHaveBeenCalledTimes(1)
    expect(env.checkStockForDishes).toHaveBeenCalledWith(["d-1", "d-2", "d-3"])
    expect(env.checkStockForDish).not.toHaveBeenCalled()
  })

  it("does not blank the grid while the stock read runs", async () => {
    let resolveStock: (value: Map<string, boolean>) => void = () => {}
    env.checkStockForDishes.mockImplementation(
      () =>
        new Promise<Map<string, boolean>>((resolve) => {
          resolveStock = resolve
        }),
    )

    const { container } = renderGrid(<DishGrid dishes={dishes} onAddToCart={() => {}} />)

    expect(screen.getByText("Bandeja")).toBeInTheDocument()
    expect(screen.getByText("Sopa")).toBeInTheDocument()
    expect(screen.getByText("Limonada")).toBeInTheDocument()
    expect(skeletonCount(container)).toBe(0)

    await act(async () => {
      resolveStock(new Map([["d-1", true]]))
    })
    expect(screen.getByText("Bandeja")).toBeInTheDocument()
  })

  it("shows no Agotado badge until the stock read answers", async () => {
    let resolveStock: (value: Map<string, boolean>) => void = () => {}
    env.checkStockForDishes.mockImplementation(
      () =>
        new Promise<Map<string, boolean>>((resolve) => {
          resolveStock = resolve
        }),
    )

    renderGrid(<DishGrid dishes={dishes} onAddToCart={() => {}} />)
    expect(screen.queryAllByText("Agotado")).toHaveLength(0)

    await act(async () => {
      resolveStock(new Map([["d-1", true]]))
    })
    // A dish the read did not mention is not sold-out.
    expect(screen.queryAllByText("Agotado")).toHaveLength(0)
  })

  it("marks only the dish the read reports as short as Agotado", async () => {
    env.checkStockForDishes.mockResolvedValue(
      new Map([
        ["d-1", true],
        ["d-2", false],
      ]),
    )

    renderGrid(<DishGrid dishes={dishes} onAddToCart={() => {}} />)
    await flush()

    // Badge over the image plus the text badge, both on the "Sopa" card only.
    expect(screen.getAllByText("Agotado")).toHaveLength(2)
    expect(screen.getByText("Limonada").closest(".overflow-hidden")?.textContent).toContain("Agregar")
  })

  it("issues one read per category change, never one per dish", async () => {
    env.checkStockForDishes.mockResolvedValue(new Map())
    const { rerender, queryClient } = renderGrid(<DishGrid dishes={dishes} onAddToCart={() => {}} />)
    await flush()

    rerender(
      <QueryClientProvider client={queryClient}>
        <DishGrid dishes={[dish("d-7", "Jugo")]} onAddToCart={() => {}} />
      </QueryClientProvider>,
    )
    await flush()

    expect(env.checkStockForDishes).toHaveBeenCalledTimes(2)
    expect(env.checkStockForDishes).toHaveBeenLastCalledWith(["d-7"])
  })

  it("treats a failed stock read as available instead of Agotado everywhere", async () => {
    env.checkStockForDishes.mockRejectedValue(new Error("offline"))
    const { container } = renderGrid(<DishGrid dishes={dishes} onAddToCart={() => {}} />)
    await flush()

    expect(screen.queryAllByText("Agotado")).toHaveLength(0)
    expect(skeletonCount(container)).toBe(0)
  })

  it("asks for nothing when inventory control is disabled", async () => {
    useConfigStore.setState({ inventoryControlEnabled: false })
    env.checkStockForDishes.mockResolvedValue(new Map())

    renderGrid(<DishGrid dishes={dishes} onAddToCart={() => {}} />)
    await flush()

    expect(env.checkStockForDishes).not.toHaveBeenCalled()
    expect(screen.queryAllByText("Agotado")).toHaveLength(0)
  })
})

describe("DishGrid — existing behavior (preserve)", () => {
  beforeEach(() => {
    env.checkStockForDishes.mockResolvedValue(new Map())
  })

  it("adds a dish to the cart on click", async () => {
    const onAddToCart = vi.fn()
    renderGrid(<DishGrid dishes={dishes} onAddToCart={onAddToCart} />)
    await flush()

    fireEvent.click(screen.getByText("Bandeja"))
    expect(onAddToCart).toHaveBeenCalledWith(dishes[0])
  })

  it("keeps adding a sold-out dish to the cart (the guard stays disabled)", async () => {
    env.checkStockForDishes.mockResolvedValue(new Map([["d-2", false]]))
    const onAddToCart = vi.fn()
    renderGrid(<DishGrid dishes={dishes} onAddToCart={onAddToCart} />)
    await flush()

    fireEvent.click(screen.getByText("Sopa"))
    expect(onAddToCart).toHaveBeenCalledWith(dishes[1])
  })

  it("opens the comments dialog on right click and adds the dish with the comment", async () => {
    const onAddToCart = vi.fn()
    renderGrid(<DishGrid dishes={dishes} onAddToCart={onAddToCart} />)
    await flush()

    fireEvent.contextMenu(screen.getByText("Bandeja"))
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText(/Sin verduras/), { target: { value: "Sin cebolla" } })
    fireEvent.click(screen.getByRole("button", { name: /Agregar al Carrito/ }))

    expect(onAddToCart).toHaveBeenCalledWith(dishes[0], "Sin cebolla")
  })

  it("renders the promotion price and badge of a discounted dish", async () => {
    useConfigStore.setState({ inventoryControlEnabled: false })
    const discounted = dish("d-4", "Promo", {
      originalPrice: 20000,
      price: 18000,
      discountAmount: 2000,
      discountPercentage: 10,
      promotionName: "Lunch",
    })
    renderGrid(<DishGrid dishes={[discounted]} onAddToCart={() => {}} />)
    await flush()

    expect(screen.getByText("-10%")).toBeInTheDocument()
    expect(screen.getByText("Lunch")).toBeInTheDocument()
  })

  it("shows the empty-category message when there are no dishes", async () => {
    renderGrid(<DishGrid dishes={[]} onAddToCart={() => {}} />)
    expect(screen.getByText("No hay productos disponibles en esta categoría")).toBeInTheDocument()
  })
})