"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { fetchCashDay, fetchCashLedger, fetchCashReport } from "@/lib/api/cash"
import { validateRegister } from "@/lib/api/registers"
import { CONFIG_QUERY_KEY, DEFAULT_BUSINESS_DAY_CUTOFF_HOUR, fetchConfig } from "@/lib/api/config"
import {
  cashDayQueryKey,
  cashLedgerQueryKey,
  cashReportQueryKey,
  type PeriodRange,
} from "@/lib/admin/cash"

/** The business-day cut-off hour (S5); the server default until config answers. */
export function useBusinessDayCutoff(): number {
  const { data } = useQuery({ queryKey: CONFIG_QUERY_KEY, queryFn: fetchConfig, staleTime: 5 * 60_000 })
  return data?.businessDayCutoffHour ?? DEFAULT_BUSINESS_DAY_CUTOFF_HOUR
}

export function useCashDay(date: string) {
  return useQuery({ queryKey: cashDayQueryKey(date), queryFn: () => fetchCashDay(date) })
}

export function useCashLedger(date: string, enabled: boolean) {
  return useQuery({ queryKey: cashLedgerQueryKey(date), queryFn: () => fetchCashLedger(date), enabled })
}

export function useCashReport(range: PeriodRange | null) {
  return useQuery({
    queryKey: range ? cashReportQueryKey(range) : ["cash", "report", "none"],
    queryFn: () => fetchCashReport(range as PeriodRange),
    enabled: range !== null,
  })
}

/** "Validar turno" (S7): refreshes the day and its ledger afterwards. */
export function useValidateRegister(date: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => validateRegister(id),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: cashDayQueryKey(date) }),
        queryClient.invalidateQueries({ queryKey: cashLedgerQueryKey(date) }),
      ])
    },
  })
}
