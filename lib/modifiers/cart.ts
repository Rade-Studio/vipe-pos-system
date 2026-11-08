import { dishIdFromCartItemId } from "@/lib/menu/cart-dish-id"
import type { CartItem } from "@/types"
import { lineKey } from "./rules"

// A non-uuid id (`item-42`) keeps the old rule: its part before the first "-".
const dishOf = (id: string) => dishIdFromCartItemId(id) ?? id.split("-")[0]

/** The identity of a cart line (F7): dish + sorted option ids + note. */
export const cartLineKey = (item: Pick<CartItem, "id" | "modifiers" | "comments">) =>
  lineKey(dishOf(item.id), (item.modifiers ?? []).map((modifier) => modifier.optionId), item.comments)
