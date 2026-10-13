import { act, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T6 (S1/S2) — `MenuSection` owned its own loading flags and re-read categories,
 * the dishes of one category and the whole `promotion_dishes` table on every
 * mount. It is mounted per active table (and unmounted by the Radix tab), so
 * choosing a table re-ran the whole menu behind full skeletons. Now categories,
 * dishes and their promotions live in React Query: a remount reads the cache and
 * a category switch keeps the previous dishes on screen while the next one loads.
 */

const env = vi.hoisted(() => ({
  getAllActive: vi.fn(),
  getByCategoryWithPromotions: vi.fn(),
}))

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    auth: { signOut: vi.fn() },
    from: () => {
      throw new Error("the menu must not read the database directly")
    },
  },
}))

vi.mock("@/lib/supabase/service", () => ({
  categoryService: { getAllActive: env.getAllActive },
}))

vi.mock("@/lib/supabase/dish-service-with-promotions", () => ({
  dishServiceWithPromotions: { getByCategoryWithPromotions: env.getByCategoryWithPromotions },
}))

import { MenuSection } from "./MenuSection"

const categories = [
  { id: "cat-1", name: "Platos", icon: null },
  { id: "cat-2", name: "Bebidas", icon: null },
]

const dishRow = (id: string, name: string, categoryId: string) => ({
  id,
  name,
  price: 12000,
  category_id: categoryId,
  image_url: "/dish.png",
  originalPrice: null,
  discountAmount: null,
  discountPercentage: null,
  promotionId: null,
  promotionName: null,
})

const rows = {
  "cat-1": [dishRow("d-1", "Bandeja", "cat-1"), dishRow("d-2", "Sopa", "cat-1")],
  "cat-2": [dishRow("d-3", "Limonada", "cat-2")],
}

/** One menu client per render; a remount keeps it, so the cache survives. */
function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000, gcTime: Number.POSITIVE_INFINITY } },
  })
}

function renderMenu(queryClient = createClient()) {
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MenuSection onAddToCart={vi.fn()} />
      </QueryClientProvider>,
    ),
  }
}

const skeletonCount = (container: HTMLElement) => container.querySelectorAll(".animate-pulse").length

/** Drains a click and the query promises behind it. */
const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** Defers the read of one category until the returned resolver is called. */
function deferCategory(categoryId: string) {
  let resolveRows: (rows: unknown[]) => void = () => {}
  env.getByCategoryWithPromotions.mockImplementation((requested: string) =>
    requested === categoryId
      ? new Promise((resolve) => {
          resolveRows = resolve as (rows: unknown[]) => void
        })
      : Promise.resolve(rows[requested as keyof typeof rows] ?? []),
  )
  return async () => {
    await act(async () => {
      resolveRows(rows[categoryId as keyof typeof rows])
    })
  }
}

beforeEach(() => {
  env.getAllActive.mockReset()
  env.getByCategoryWithPromotions.mockReset()
  env.getAllActive.mockResolvedValue(categories)
  env.getByCategoryWithPromotions.mockImplementation(async (categoryId: string) => rows[categoryId as keyof typeof rows] ?? [])
})

describe("MenuSection — cached menu (T6/S1/S2)", () => {
  it("loads the first category once and shows its dishes", async () => {
    const { container } = renderMenu()

    expect(await screen.findByText("Bandeja")).toBeInTheDocument()
    expect(screen.getByText("Sopa")).toBeInTheDocument()
    expect(env.getAllActive).toHaveBeenCalledTimes(1)
    expect(env.getByCategoryWithPromotions).toHaveBeenCalledTimes(1)
    expect(env.getByCategoryWithPromotions).toHaveBeenCalledWith("cat-1")
    expect(skeletonCount(container)).toBe(0)
  })

  it("keeps the previous dishes on screen while the next category loads", async () => {
    const { container } = renderMenu()
    expect(await screen.findByText("Bandeja")).toBeInTheDocument()

    const resolveBebidas = deferCategory("cat-2")

    await act(async () => {
      screen.getByRole("button", { name: /Bebidas/ }).click()
    })
    await flush()

    expect(screen.getByText("Bandeja")).toBeInTheDocument()
    expect(screen.getByText("Sopa")).toBeInTheDocument()
    expect(skeletonCount(container)).toBe(0)

    await resolveBebidas()
    expect(await screen.findByText("Limonada")).toBeInTheDocument()
    expect(screen.queryByText("Bandeja")).not.toBeInTheDocument()
  })

  it("re-renders from the cache on remount: no request, no full skeletons", async () => {
    const { unmount, queryClient } = renderMenu()
    expect(await screen.findByText("Bandeja")).toBeInTheDocument()
    unmount()

    // Same cache, new mount: this is what selecting another table does.
    const { container } = renderMenu(queryClient)
    expect(await screen.findByText("Bandeja")).toBeInTheDocument()

    expect(env.getAllActive).toHaveBeenCalledTimes(1)
    expect(env.getByCategoryWithPromotions).toHaveBeenCalledTimes(1)
    expect(skeletonCount(container)).toBe(0)
  })

  it("serves an already-loaded category from the cache when picked again", async () => {
    const { container } = renderMenu()
    expect(await screen.findByText("Bandeja")).toBeInTheDocument()

    await act(async () => {
      screen.getByRole("button", { name: /Bebidas/ }).click()
    })
    expect(await screen.findByText("Limonada")).toBeInTheDocument()
    expect(env.getByCategoryWithPromotions).toHaveBeenCalledTimes(2)

    await act(async () => {
      screen.getByRole("button", { name: /Platos/ }).click()
    })
    expect(await screen.findByText("Bandeja")).toBeInTheDocument()

    // "cat-1" is still fresh (staleTime 30 s): no third read, no skeletons.
    expect(env.getByCategoryWithPromotions).toHaveBeenCalledTimes(2)
    expect(skeletonCount(container)).toBe(0)
  })

  it("shows skeletons only while the very first category is still loading", async () => {
    const { container } = renderMenu()
    await flush()

    expect(skeletonCount(container)).toBeGreaterThan(0)
    expect(screen.queryByText("Bandeja")).not.toBeInTheDocument()

    expect(await screen.findByText("Bandeja")).toBeInTheDocument()
    expect(skeletonCount(container)).toBe(0)
  })
})

describe("MenuSection — existing behavior (preserve)", () => {
  it("adds the tapped dish to the cart", async () => {
    const onAddToCart = vi.fn()
    render(
      <QueryClientProvider client={createClient()}>
        <MenuSection onAddToCart={onAddToCart} />
      </QueryClientProvider>,
    )
    expect(await screen.findByText("Bandeja")).toBeInTheDocument()

    const card = screen.getByText("Bandeja").closest(".cursor-pointer") as HTMLElement
    act(() => {
      card.click()
    })
    expect(onAddToCart).toHaveBeenCalledWith(expect.objectContaining({ id: "d-1", name: "Bandeja" }))
  })

  it("shows the empty message when there are no categories", async () => {
    env.getAllActive.mockResolvedValue([])
    renderMenu()

    expect(await screen.findByText("No hay categorías disponibles")).toBeInTheDocument()
    expect(env.getByCategoryWithPromotions).not.toHaveBeenCalled()
  })

  it("shows the empty message when the selected category has no dishes", async () => {
    env.getAllActive.mockResolvedValue([categories[0]])
    env.getByCategoryWithPromotions.mockResolvedValue([])
    renderMenu()

    expect(await screen.findByText("No hay productos disponibles en esta categoría")).toBeInTheDocument()
  })

  it("keeps the promotion fields the grid renders", async () => {
    env.getByCategoryWithPromotions.mockResolvedValue([
      {
        ...dishRow("d-9", "Promo", "cat-1"),
        originalPrice: 20000,
        price: 18000,
        discountAmount: 2000,
        discountPercentage: 10,
        promotionId: "p-1",
        promotionName: "Lunch",
      },
    ])
    renderMenu()

    expect(await screen.findByText("-10%")).toBeInTheDocument()
    expect(screen.getByText("Lunch")).toBeInTheDocument()
  })
})