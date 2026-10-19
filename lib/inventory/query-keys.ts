/**
 * React Query keys for the inventory module, all under ['inventory'].
 *
 * Detail keys nest under their list key so invalidating the list prefix
 * (e.g. `purchases()`) refreshes the details too. Called without arguments,
 * the parameterized keys return their prefix for invalidation.
 */

export const inventoryKeys = {
  all: ['inventory'] as const,
  items: () => ['inventory', 'items'] as const,
  item: (id: string) => ['inventory', 'items', id] as const,
  lots: (itemId?: string) => (itemId ? (['inventory', 'lots', itemId] as const) : (['inventory', 'lots'] as const)),
  movements: (filters?: object) =>
    filters ? (['inventory', 'movements', filters] as const) : (['inventory', 'movements'] as const),
  formulas: () => ['inventory', 'formulas'] as const,
  suppliers: () => ['inventory', 'suppliers'] as const,
  purchases: (filters?: object) =>
    filters ? (['inventory', 'purchases', 'list', filters] as const) : (['inventory', 'purchases'] as const),
  purchase: (id: string) => ['inventory', 'purchases', 'detail', id] as const,
  counts: () => ['inventory', 'counts'] as const,
  count: (id: string) => ['inventory', 'counts', id] as const,
  batches: () => ['inventory', 'batches'] as const,
  locations: () => ['inventory', 'locations'] as const,
  categories: () => ['inventory', 'categories'] as const,
  overview: (days?: number) =>
    days === undefined ? (['inventory', 'overview'] as const) : (['inventory', 'overview', days] as const),
}

/** Prefix of the waiter grid's dish availability cache (`hooks/use-menu.ts` dishStockKey). */
export const menuStockKey = ['menu', 'stock'] as const
