"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/utils/helpers"
import { getRegisterPaidOrders } from "@/lib/api/registers"
import { paidOrderRows, type PaidOrderRow } from "@/lib/cashier/paid-orders"
import { Button } from "@/components/ui/button"
import { Money } from "./cashier-ui"

export const registerPaidOrdersQueryKey = (registerId: string) => ["register-paid-orders", registerId] as const

/**
 * The "Pagadas" queue tab (T24): the open register's paid orders, newest
 * first. Read when the tab opens and on every return to it.
 */
export function PaidOrdersList({
  registerId,
  onVoid,
}: {
  registerId: string | null
  /** F3: "Anular" a payment through the step sheet. */
  onVoid?: (row: PaidOrderRow) => void
}) {
  const { data = [], isLoading, isError } = useQuery({
    queryKey: registerPaidOrdersQueryKey(registerId ?? ""),
    queryFn: () => getRegisterPaidOrders(registerId!),
    enabled: registerId !== null,
    refetchOnMount: "always",
  })
  const rows = useMemo(() => paidOrderRows(data), [data])

  if (registerId === null) {
    return (
      <div className="rounded-card border border-dashed border-line p-4 text-center">
        <h3 className="font-semibold text-fg">Caja cerrada</h3>
        <p className="mt-1 text-sm text-muted-fg">Abre la caja para ver las cuentas pagadas del turno.</p>
      </div>
    )
  }
  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        <span className="sr-only">Cargando cuentas pagadas…</span>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-card motion-reduce:animate-none" />
        ))}
      </div>
    )
  }
  if (isError) return <p className="p-2 text-sm text-status-danger-fg">No se pudieron cargar las cuentas pagadas.</p>
  if (rows.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-line p-4 text-center">
        <h3 className="font-semibold text-fg">Aún no hay cuentas pagadas</h3>
        <p className="mt-1 text-sm text-muted-fg">Cada cobro de este turno aparecerá aquí.</p>
      </div>
    )
  }
  return (
    <ul aria-label="Cuentas pagadas" className="flex min-h-0 flex-col gap-2">
      {rows.map((row) => (
        <li key={row.key} className="min-w-0 rounded-card border border-line bg-surface p-3">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-semibold text-fg">
                {row.folio && <span className="text-muted-fg">{row.folio} · </span>}
                {row.place}
              </p>
              <p className="break-words text-xs text-muted-fg">{row.methods}</p>
            </div>
            <div className="shrink-0 text-right">
              <Money className="block text-sm font-bold text-fg">{formatCurrency(row.total)}</Money>
              <span className="block text-xs tabular-nums text-muted-fg">{row.time}</span>
            </div>
          </div>
          {row.tip > 0 ? (
            <p className="mt-1 truncate text-xs text-muted-fg">
              {row.waiterName ? `Propina para ${row.waiterName} ` : "Propina "}
              <Money>{formatCurrency(row.tip)}</Money>
            </p>
          ) : (
            row.waiterName && <p className="mt-1 truncate text-xs text-muted-fg">{row.waiterName} · sin propina</p>
          )}
          {onVoid && (
            <div className="mt-2 flex justify-end">
              <Button
                variant="outline"
                className="h-11 px-3"
                aria-label={`Anular pago ${[row.folio, row.place].filter(Boolean).join(" ")}`}
                onClick={() => onVoid(row)}
              >
                Anular
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
