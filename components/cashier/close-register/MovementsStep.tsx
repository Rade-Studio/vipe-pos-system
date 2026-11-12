"use client"

import { CASH_MOVEMENT_REASONS, type CashMovement } from "@/lib/api/registers"
import type { RegisterSummary } from "@/lib/payments/register-summary"
import { Money, Chip } from "@/components/cashier/cashier-ui"
import { pesos, signedPesos, slipTime } from "@/components/printing/slip-format"

export const movementReasonLabel = (movement: CashMovement): string =>
  CASH_MOVEMENT_REASONS.find((reason) => reason.value === movement.reason)?.label ?? "Sin motivo"

/** Step 2 (caja-cierres S3): the shift's cash entries and withdrawals, then the tips to pay out. */
export function MovementsStep({ movements, summary }: { movements: readonly CashMovement[] | null; summary: RegisterSummary | undefined }) {
  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h4 className="font-semibold">Entradas y salidas de efectivo</h4>
        {movements === null ? (
          <p className="text-sm text-muted-fg">Cargando movimientos…</p>
        ) : movements.length === 0 ? (
          <p className="text-sm text-muted-fg">No hubo entradas ni salidas en este turno.</p>
        ) : (
          <ul aria-label="Entradas y salidas de efectivo" className="divide-y divide-line rounded-md border border-line text-sm">
            {movements.map((movement) => {
              const deposit = movement.type === "deposit"
              return (
                <li key={movement.id} className="flex items-start justify-between gap-3 p-3">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip tone={deposit ? "ok" : "danger"}>{deposit ? "Entrada" : "Salida"}</Chip>
                      <span className="font-medium">{movementReasonLabel(movement)}</span>
                    </div>
                    <p className="text-xs text-muted-fg">
                      {slipTime(new Date(movement.timestamp))} · {movement.createdBy?.name ?? "Autor desconocido"}
                      {movement.description ? ` · ${movement.description}` : ""}
                    </p>
                  </div>
                  <Money className={deposit ? "font-semibold text-status-ok-fg" : "font-semibold text-status-danger-fg"}>
                    {signedPesos(deposit ? movement.amount : -movement.amount)}
                  </Money>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {summary && (
        <section className="space-y-1 rounded-md border border-line p-3 text-sm">
          <h4 className="font-semibold">Propinas</h4>
          <div className="flex justify-between gap-3">
            <span>Propinas del turno</span>
            <Money>{pesos(summary.totalTips)}</Money>
          </div>
          <div className="flex justify-between gap-3 font-medium">
            <span>Propinas a pagar en efectivo</span>
            <Money>{pesos(summary.tipsPayout)}</Money>
          </div>
          <p className="text-xs text-muted-fg">Las propinas no son venta del restaurante.</p>
        </section>
      )}
    </div>
  )
}
