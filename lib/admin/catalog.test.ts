/**
 * T9 (S1/S2) — Configuración sub-tab reads.
 *
 * The audit row "admin | config sub-tabs | each list reloads on every visit (no
 * cache)" is what this module fixes. Every sub-tab mounted its own
 * `useEffect` + local state, so Radix unmounting the inactive `TabsContent` and
 * remounting it on the next visit re-issued the read every time; the Menú tab
 * alone read `categories` twice (once for `CategoryList`, once inside
 * `DishList`).
 *
 * Two rules this test pins down:
 *   1. ONE key per data set, shared by every reader (so a second reader is a
 *      cache hit, not a second request), and mutations invalidate exactly those
 *      keys.
 *   2. A stale-enough window (`ADMIN_LIST_STALE_MS`) so a tab switch inside it
 *      issues zero requests AND does not blank the list.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

// T7b: categories, dishes and promotions come from the catalog API.
const catalogApi = vi.hoisted(() => ({
  fetchCategories: vi.fn(),
  fetchDishes: vi.fn(),
  fetchPromotions: vi.fn(),
  getMenuDraft: vi.fn(),
  getMenuPublication: vi.fn(),
}))
vi.mock("@/lib/api/catalog", () => catalogApi)

// T9 (redesign): the menu tree editor reads every subcategory, inactive too.
const subcategoriesApi = vi.hoisted(() => ({ getAll: vi.fn() }))
vi.mock("@/lib/api/subcategories", () => subcategoriesApi)

// T12: the staff list comes from `GET /api/staff`.
const staffApi = vi.hoisted(() => ({ listStaff: vi.fn() }))
vi.mock("@/lib/api/staff", () => staffApi)

import {
  ADMIN_LIST_STALE_MS,
  ADMIN_STAFF_ROLES,
  buildAdminMenuTree,
  CATEGORY_COLORS,
  catalogKeys,
  fetchCategories,
  fetchSubcategories,
  moveItem,
  planGeneralSubcategory,
  planMergeIntoCategory,
  fetchDishes,
  fetchPromotions,
  fetchStaff,
  invalidateCatalogReaders,
  invalidateMenuReaders,
  checkQuickNote,
  draftMenuTree,
  fetchMenuDraft,
  fetchMenuPublication,
  pendingChangesLabel,
  publishedAgo,
  TILE_NAME_LIMIT,
  tileNameHint,
} from "./catalog"

beforeEach(() => {
  for (const fn of Object.values(catalogApi)) fn.mockReset().mockResolvedValue([])
})

const ALL_KEYS = [
  catalogKeys.categories,
  catalogKeys.dishes,
  catalogKeys.promotions,
  catalogKeys.subcategories,
  catalogKeys.staff,
  catalogKeys.draft,
  catalogKeys.publication,
]

describe("catalogKeys", () => {
  it("gives every data set its own slot (no accidental sharing)", () => {
    const serialized = ALL_KEYS.map((key) => JSON.stringify(key))

    expect(new Set(serialized).size).toBe(ALL_KEYS.length)
  })

  it("exposes stable, serialisable keys so mutations can invalidate them from anywhere", () => {
    for (const key of ALL_KEYS as readonly (readonly string[])[]) {
      expect(key.length).toBeGreaterThan(0)
      expect(key.every((part) => typeof part === "string")).toBe(true)
    }

    // Invalidating by a PREFIX is how a mutation refreshes every reader, so the
    // menu reads must share a prefix.
    expect(catalogKeys.categories[0]).toBe(catalogKeys.dishes[0])
    expect(catalogKeys.categories[0]).toBe(catalogKeys.promotions[0])
  })

  it("returns the SAME array identity on every read (so it is safe as a dep and in a key)", () => {
    expect(catalogKeys.categories).toBe(catalogKeys.categories)
    expect(catalogKeys.staff).toBe(catalogKeys.staff)
  })
})

describe("fetchers", () => {
  it("exposes one fetcher per cached data set", () => {
    for (const fetcher of [
      fetchCategories,
      fetchDishes,
      fetchPromotions,
      fetchStaff,
    ]) {
      expect(typeof fetcher).toBe("function")
    }
  })

  it("reads the whole catalog through the API (no filter: the admin lists show inactive rows too)", async () => {
    await fetchCategories()
    await fetchDishes()
    await fetchPromotions()

    expect(catalogApi.fetchCategories).toHaveBeenCalledWith()
    expect(catalogApi.fetchDishes).toHaveBeenCalledWith()
    expect(catalogApi.fetchPromotions).toHaveBeenCalledWith()
  })

  it("reads the staff through the API, never from profiles", async () => {
    staffApi.listStaff.mockResolvedValue([])
    await fetchStaff()

    expect(staffApi.listStaff).toHaveBeenCalledWith()
  })

  it("keeps exactly the staff roles the Personal screen manages (never admin)", async () => {
    const roles = ["admin", ...ADMIN_STAFF_ROLES]
    staffApi.listStaff.mockResolvedValue(roles.map((role) => ({ id: role, role })))

    const staff = await fetchStaff()

    expect(staff.map((member) => member.role)).toEqual([...ADMIN_STAFF_ROLES])
    expect(ADMIN_STAFF_ROLES).not.toContain("admin")
  })

  it("raises instead of swallowing a failed read, so the screen can show its error state", async () => {
    catalogApi.fetchCategories.mockRejectedValue(new Error("boom"))

    await expect(fetchCategories()).rejects.toThrow("boom")
  })
})

describe("invalidateCatalogReaders", () => {
  it("refreshes the admin list and the POS and delivery menus", async () => {
    const invalidateQueries = vi.fn(async (_filters: { queryKey: unknown }) => undefined)

    await invalidateCatalogReaders({ invalidateQueries } as never, catalogKeys.dishes)

    expect(invalidateQueries.mock.calls.map(([filters]) => filters.queryKey)).toEqual([
      catalogKeys.dishes,
      ["menu"],
      ["delivery-menu-categories"],
      ["delivery-menu-dishes"],
      catalogKeys.draft,
      catalogKeys.publication,
    ])
  })

  it("a saved order alone also refreshes the draft and the 'n cambios sin publicar' count (T27)", async () => {
    const invalidateQueries = vi.fn(async (_filters: { queryKey: unknown }) => undefined)

    await invalidateMenuReaders({ invalidateQueries } as never)

    expect(invalidateQueries.mock.calls.map(([filters]) => filters.queryKey)).toEqual([
      ["menu"],
      ["delivery-menu-categories"],
      ["delivery-menu-dishes"],
      catalogKeys.draft,
      catalogKeys.publication,
    ])
  })
})

describe("menu publication (T27)", () => {
  it("reads the draft and the publication status through the API, under the menu prefix", async () => {
    catalogApi.getMenuDraft.mockResolvedValue({ categories: [], uncategorized: [] })
    catalogApi.getMenuPublication.mockResolvedValue({ publishedAt: null, publishedByName: null, pendingChanges: 0 })

    await expect(fetchMenuDraft()).resolves.toEqual({ categories: [], uncategorized: [] })
    await expect(fetchMenuPublication()).resolves.toEqual({ publishedAt: null, publishedByName: null, pendingChanges: 0 })
    expect(catalogKeys.draft.slice(0, 2)).toEqual(["catalog", "menu"])
    expect(catalogKeys.publication.slice(0, 2)).toEqual(["catalog", "menu"])
  })

  it("names the pending changes in Spanish, singular and plural", () => {
    expect(pendingChangesLabel(1)).toBe("1 cambio sin publicar")
    expect(pendingChangesLabel(4)).toBe("4 cambios sin publicar")
  })

  it("says how long ago the menu was published", () => {
    const now = Date.parse("2026-11-06T20:00:00Z")
    expect(publishedAgo("2026-11-06T19:59:30Z", now)).toBe("hace un momento")
    expect(publishedAgo("2026-11-06T19:55:00Z", now)).toBe("hace 5 min")
    expect(publishedAgo("2026-11-06T18:00:00Z", now)).toBe("hace 2 h")
    expect(publishedAgo("2026-11-03T20:00:00Z", now)).toBe("hace 3 d")
    // A clock a little ahead of the server never reads "hace -1 min".
    expect(publishedAgo("2026-11-06T20:00:40Z", now)).toBe("hace un momento")
  })

  it("builds the editor nodes from the draft tree", () => {
    const tree = {
      categories: [
        {
          ...cat("c-2", "Postres", 1),
          subcategories: [],
          dishes: [{ ...dish("d-5", "Natas", "c-2"), quickNotes: ["Sin azúcar"], available: true }],
        },
        {
          ...cat("c-1", "Bebidas", 0),
          subcategories: [sub("s-1", "c-1", "Jugos", 0)],
          dishes: [{ ...dish("d-1", "Lulo", "c-1", "s-1"), quickNotes: [], available: true }],
        },
      ],
      uncategorized: [],
    }

    const nodes = draftMenuTree(tree as never)

    expect(nodes.map((node) => node.category.name)).toEqual(["Bebidas", "Postres"])
    expect(nodes[0].subcategories[0].dishes.map((d) => d.name)).toEqual(["Lulo"])
    expect(nodes[1].looseDishes[0].quickNotes).toEqual(["Sin azúcar"])
    expect(nodes[1].skipsSubcategoryStep).toBe(true)
  })
})

describe("checkQuickNote (T27, the API's rules and messages)", () => {
  it("accepts a note, trimmed and with inner spaces collapsed", () => {
    expect(checkQuickNote([], "  Sin   cebolla ")).toEqual({ note: "Sin cebolla" })
  })

  it("refuses an empty or a too long note", () => {
    const message = "Cada nota rápida debe tener entre 1 y 30 caracteres"
    expect(checkQuickNote([], "   ")).toEqual({ error: message })
    expect(checkQuickNote([], "x".repeat(31))).toEqual({ error: message })
    expect(checkQuickNote([], "x".repeat(30))).toEqual({ note: "x".repeat(30) })
  })

  it("refuses a duplicate ignoring case", () => {
    expect(checkQuickNote(["Sin hielo"], "SIN HIELO")).toEqual({ error: "Las notas rápidas no se pueden repetir" })
  })

  it("refuses a 13th note", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `Nota ${i}`)
    expect(checkQuickNote(twelve, "Otra")).toEqual({ error: "Máximo 12 notas rápidas" })
    expect(checkQuickNote(twelve.slice(1), "Otra")).toEqual({ note: "Otra" })
  })
})

describe("tileNameHint (T27, L19 e)", () => {
  it("counts the trimmed name against the 22 characters a tile shows in two lines", () => {
    expect(TILE_NAME_LIMIT).toBe(22)
    expect(tileNameHint(" Bebidas ")).toEqual({ count: 7, over: false })
    expect(tileNameHint("x".repeat(22))).toEqual({ count: 22, over: false })
    expect(tileNameHint("x".repeat(23))).toEqual({ count: 23, over: true })
  })
})

describe("ADMIN_LIST_STALE_MS", () => {
  it("is long enough that revisiting a sub-tab inside it costs zero requests", () => {
    expect(ADMIN_LIST_STALE_MS).toBeGreaterThan(30_000)
  })
})

// ---- T9 (redesign): the admin menu tree ------------------------------------

const cat = (id: string, name: string, sortOrder: number, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  description: null,
  icon: "Soup",
  active: true,
  sortOrder,
  color: "neutral" as const,
  hasSubcategories: false,
  createdAt: null,
  updatedAt: null,
  ...extra,
})
const sub = (id: string, categoryId: string, name: string, sortOrder: number, active = true) => ({
  id,
  categoryId,
  name,
  sortOrder,
  active,
  createdAt: null,
  updatedAt: null,
})
const dish = (id: string, name: string, categoryId: string | null, subcategoryId: string | null = null, sortOrder = 0) => ({
  id,
  name,
  description: null,
  price: 1000,
  categoryId,
  subcategoryId,
  imageUrl: null,
  active: true,
  allowComments: false,
  sortOrder,
  quickNotes: [],
  createdAt: null,
  updatedAt: null,
})

describe("fetchSubcategories", () => {
  it("reads every subcategory, inactive ones too, under the menu prefix", async () => {
    subcategoriesApi.getAll.mockReset().mockResolvedValue([])
    await fetchSubcategories()

    expect(subcategoriesApi.getAll).toHaveBeenCalledWith({ includeInactive: true })
    expect(catalogKeys.subcategories.slice(0, 2)).toEqual(["catalog", "menu"])
  })
})

describe("CATEGORY_COLORS", () => {
  it("is the closed colour set of the API, each with a Spanish label, neutral first", () => {
    expect(CATEGORY_COLORS.map((c) => c.value)).toEqual(["neutral", "yellow", "orange", "sky", "violet", "emerald", "rose"])
    expect(CATEGORY_COLORS.map((c) => c.label)).toEqual(["Neutro", "Amarillo", "Naranja", "Cielo", "Violeta", "Esmeralda", "Rosa"])
  })
})

describe("moveItem", () => {
  it("moves one entry and returns a new array", () => {
    const list = ["a", "b", "c", "d"]
    expect(moveItem(list, 0, 2)).toEqual(["b", "c", "a", "d"])
    expect(moveItem(list, 3, 0)).toEqual(["d", "a", "b", "c"])
    expect(list).toEqual(["a", "b", "c", "d"])
  })

  it("returns null when the move leaves the list or does nothing", () => {
    expect(moveItem(["a", "b"], 0, -1)).toBeNull()
    expect(moveItem(["a", "b"], 1, 2)).toBeNull()
    expect(moveItem(["a", "b"], 1, 1)).toBeNull()
  })
})

describe("buildAdminMenuTree", () => {
  const categories = [cat("c-2", "Postres", 1), cat("c-1", "Bebidas", 0), cat("c-3", "Arepas", 1)]
  const subcategories = [
    sub("s-2", "c-1", "Gaseosas", 1),
    sub("s-1", "c-1", "Jugos", 0),
    sub("s-3", "c-1", "Viejas", 2, false),
  ]
  const dishes = [
    dish("d-3", "Mora", "c-1", "s-1"),
    dish("d-1", "Lulo", "c-1", "s-1"),
    dish("d-2", "Cola", "c-1", "s-2"),
    dish("d-4", "Agua", "c-1"),
    dish("d-5", "Natas", "c-2"),
    dish("d-6", "Suelto", null),
  ]
  const tree = buildAdminMenuTree(categories, subcategories, dishes)

  it("orders categories by sort order, then name", () => {
    expect(tree.map((node) => node.category.name)).toEqual(["Bebidas", "Arepas", "Postres"])
  })

  it("nests the subcategories in order, inactive ones included, with their dishes by name", () => {
    const bebidas = tree[0]
    expect(bebidas.subcategories.map((s) => s.subcategory.name)).toEqual(["Jugos", "Gaseosas", "Viejas"])
    expect(bebidas.subcategories[0].dishes.map((d) => d.name)).toEqual(["Lulo", "Mora"])
    expect(bebidas.looseDishes.map((d) => d.name)).toEqual(["Agua"])
    expect(bebidas.dishCount).toBe(4)
  })

  it("orders the dishes of a group by sort order, then name (T20 dish reorder)", () => {
    const ordered = buildAdminMenuTree(
      [cat("c-1", "Bebidas", 0)],
      [sub("s-1", "c-1", "Jugos", 0)],
      [dish("d-1", "Lulo", "c-1", "s-1", 1), dish("d-2", "Mora", "c-1", "s-1", 0), dish("d-3", "Agua", "c-1", null, 1), dish("d-4", "Té", "c-1", null, 0), dish("d-5", "Café", "c-1", null, 1)],
    )
    expect(ordered[0].subcategories[0].dishes.map((d) => d.name)).toEqual(["Mora", "Lulo"])
    expect(ordered[0].looseDishes.map((d) => d.name)).toEqual(["Té", "Agua", "Café"])
  })

  it("derives 'sin subcategorías' from the dishes: none of them sits in a subcategory", () => {
    expect(tree[0].skipsSubcategoryStep).toBe(false)
    expect(tree[2].skipsSubcategoryStep).toBe(true)
    expect(tree[1].skipsSubcategoryStep).toBe(true)
    expect(tree[1].dishCount).toBe(0)
  })
})

describe("subcategory step actions", () => {
  const categories = [cat("c-1", "Bebidas", 0), cat("c-2", "Postres", 1)]
  const subcategories = [sub("s-1", "c-1", "Jugos", 0), sub("s-9", "c-2", "general", 0)]
  const dishes = [
    dish("d-1", "Lulo", "c-1", "s-1"),
    dish("d-4", "Agua", "c-1"),
    dish("d-5", "Natas", "c-2"),
    dish("d-6", "Arroz con leche", "c-2"),
  ]
  const [bebidas, postres] = buildAdminMenuTree(categories, subcategories, dishes)

  it("merging takes every dish out of its subcategory, in tree order", () => {
    expect(planMergeIntoCategory(bebidas)).toEqual(["d-1"])
    expect(planMergeIntoCategory(postres)).toEqual([])
  })

  it("'General' reuses an existing subcategory of that name (any case) and moves the loose dishes", () => {
    expect(planGeneralSubcategory(postres)).toEqual({ existingId: "s-9", name: "General", dishIds: ["d-6", "d-5"] })
    expect(planGeneralSubcategory(bebidas)).toEqual({ existingId: null, name: "General", dishIds: ["d-4"] })
  })
})
