import { useContext } from "react"
import { QueryClient, QueryClientContext, useQuery } from "@tanstack/react-query"
import { CONFIG_QUERY_KEY, fetchConfig } from "./config"

/**
 * S2 (F6): whether the restaurant uses thermal printers (business config
 * `printingEnabled`). Screens hide every print action and never call the
 * print API when it is false. Unknown (loading, unreadable config, or no
 * query client around the screen) reads as true, today's behaviour; the API
 * still refuses with 409 printing_disabled, which lib/api/print shows.
 */
const detached = new QueryClient()

export function usePrintingEnabled(): boolean {
  const client = useContext(QueryClientContext)
  const { data } = useQuery({ queryKey: CONFIG_QUERY_KEY, queryFn: fetchConfig, enabled: client !== undefined }, client ?? detached)
  return data?.printingEnabled !== false
}
