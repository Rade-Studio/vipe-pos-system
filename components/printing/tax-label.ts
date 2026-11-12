import { useContext } from "react"
import { QueryClient, QueryClientContext, useQuery } from "@tanstack/react-query"
import { CONFIG_QUERY_KEY, fetchConfig, type TaxType } from "@/lib/api/config"

/**
 * The configured tax type (caja-cierres S9) on bills, slips and the informe Z:
 * INC (impuesto nacional al consumo, the server default) or IVA, printed with
 * the rate as `INC (8 %)`. Kept apart from lib/api/config so suites that stub
 * that module whole still render the printing views.
 */

export const DEFAULT_TAX_TYPE: TaxType = "INC"
export const TAX_TYPES: readonly { value: TaxType; name: string }[] = [
  { value: "INC", name: "Impuesto nacional al consumo" },
  { value: "IVA", name: "IVA" },
]

export function taxName(type: TaxType | undefined): string {
  return TAX_TYPES.find((tax) => tax.value === type)?.name ?? TAX_TYPES[0].name
}

/** `INC (8 %)`, `IVA (19 %)`, `INC (8,5 %)`. */
export function taxLabel(type: TaxType | undefined, rate: number): string {
  return `${type ?? DEFAULT_TAX_TYPE} (${String(rate).replace(".", ",")} %)`
}

/** Prices include the tax: base = round(sales / (1 + rate / 100)), tax = sales − base, whole pesos. */
export function taxBreakdown(sales: number, rate: number): { base: number; tax: number } {
  const base = Math.round((sales * 100) / (100 + rate))
  return { base, tax: sales - base }
}

/** Tax setting a slip prints: the type and the rate. */
export type SlipTax = { type: TaxType; rate: number }

const detached = new QueryClient()

/** The configured tax type from the shared config read; INC until it answers or outside a QueryClientProvider. */
export function useTaxType(): TaxType {
  const client = useContext(QueryClientContext)
  const { data } = useQuery({ queryKey: CONFIG_QUERY_KEY, queryFn: fetchConfig, enabled: client !== undefined }, client ?? detached)
  return data?.taxType ?? DEFAULT_TAX_TYPE
}
