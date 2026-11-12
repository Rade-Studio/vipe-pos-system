"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { emitZReport, fetchCashDay, fetchCashLedger, fetchCashReport, fetchZReport, fetchZReports } from "@/lib/api/cash"
import { validateRegister } from "@/lib/api/registers"
import { CONFIG_QUERY_KEY, DEFAULT_BUSINESS_DAY_CUTOFF_HOUR, fetchConfig } from "@/lib/api/config"
import {
  cashDayQueryKey,
  cashLedgerQueryKey,
  cashReportQueryKey,
  type PeriodRange,
  zQueryKey,
  zReportsQueryKey,
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

/** "Emitir informe Z" (S8): refreshes the day and every Z list afterwards. */
export function useEmitZReport(date: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => emitZReport(date),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: cashDayQueryKey(date) }),
        queryClient.invalidateQueries({ queryKey: ["cash", "z", "list"] }),
      ])
    },
  })
}

/** The Zs of a range with the gaps in the numbering (Período). */
export function useZReports(range: { from: string; to: string } | null) {
  return useQuery({
    queryKey: range ? zReportsQueryKey(range) : ["cash", "z", "list", "none"],
    queryFn: () => fetchZReports(range as { from: string; to: string }),
    enabled: range !== null,
  })
}

/** One stored Z to reprint; a Z never changes, so a cached read is reused. */
export function useFetchZReport() {
  const queryClient = useQueryClient()
  return (number: number) => queryClient.fetchQuery({ queryKey: zQueryKey(number), queryFn: () => fetchZReport(number), staleTime: Infinity })
}
