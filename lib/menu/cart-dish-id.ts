const UUID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/**
 * The dish id behind a cart item id. Cart ids are `<dish uuid>` or
 * `<dish uuid>-<suffix>` (one cart line per add), so the dish is the leading
 * uuid; anything else (`item-42`, temporary ids) has no dish.
 *
 * `order_items.dish_id` must carry it: the stock RPCs read the formula through
 * it, and the old `id.includes("-") ? null : id` rule stored null for every
 * line because a uuid always contains "-".
 */
export function dishIdFromCartItemId(id: string): string | null {
  const match = UUID_PREFIX.exec(id)
  return match ? match[0] : null
}
