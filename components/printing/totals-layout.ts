/**
 * S10: the totals layout the invoice uses, with the same rule as the ESC/POS renderers.
 * "discounts" (Subtotal gross, Descuentos, Base, Hoy ahorraste) only when the payload carries
 * `bill.grossSubtotal` or a discounts list on the invoice or an item; else the previous totals.
 */
export function totalsLayout(invoice: {
  bill?: { grossSubtotal?: number | null; totalDiscounts?: number } | null
  discounts?: readonly unknown[] | null
  items?: ReadonlyArray<{ discounts?: readonly unknown[] | null }> | null
}): "discounts" | "legacy" {
  const carriesDiscounts =
    invoice.bill?.grossSubtotal != null ||
    Array.isArray(invoice.discounts) ||
    (invoice.items ?? []).some((item) => Array.isArray(item.discounts))
  return carriesDiscounts ? "discounts" : "legacy"
}
