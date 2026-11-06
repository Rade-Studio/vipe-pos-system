"use client";

import { useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { queryClient } from "@/lib/queryClient";
import { registerPaymentsQueryKey } from "@/hooks/use-register-payments";
import { registerSummaryQueryKey } from "@/lib/payments/register-summary";
import { CloseRegisterDialog } from "./CloseRegisterDialog";
import { formatCurrency } from "@/utils/helpers";
import { useRegisterSummary } from "@/hooks/use-register-summary";
import { shiftKpis } from "@/lib/payments/register-summary";
import { Eyebrow, Money } from "./cashier-ui";

interface ShiftSummarySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  registerId: string | null;
  openerName: string | null;
  openedAt: string | null;
  /** Rows still to charge (tables, partials and deliveries). */
  pendingCount: number;
  /** "Movimientos de caja": the full shift list (TransactionsList tab). */
  onShowMovements: () => void;
}

/** "Resumen del turno" sheet (T24): the shift KPIs from register_summary through `shiftKpis`. */
export function ShiftSummarySheet({
  open,
  onOpenChange,
  registerId,
  openerName,
  openedAt,
  pendingCount,
  onShowMovements,
}: ShiftSummarySheetProps) {
  const ids = useMemo(() => (registerId ? [registerId] : []), [registerId]);
  const { data: summary, isLoading } = useRegisterSummary(ids);
  const kpis = summary ? shiftKpis(summary) : null;
  const [counted, setCounted] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);
  // Arqueo: compared with what the close records (expected cash after handing
  // the tips to the waiters). Only shown; the close dialog saves the close.
  const difference =
    summary && counted !== ""
      ? Number(counted) - summary.expectedCashAfterTips
      : null;
  const refreshSummary = () => {
    if (ids.length === 0) return;
    queryClient.invalidateQueries({ queryKey: registerSummaryQueryKey(ids) });
    queryClient.invalidateQueries({ queryKey: registerPaymentsQueryKey(ids) });
  };
  const subtitle = [
    openerName,
    kpis
      ? `${kpis.tickets} ${kpis.tickets === 1 ? "cuenta pagada" : "cuentas pagadas"}`
      : null,
    `${pendingCount} por cobrar`,
  ]
    .filter(Boolean)
    .join(" · ");

  const cards = kpis
    ? [
        { label: "Ventas", value: formatCurrency(kpis.sales) },
        { label: "Propinas", value: formatCurrency(kpis.tips) },
        { label: "Tickets", value: String(kpis.tickets) },
        { label: "Ticket promedio", value: formatCurrency(kpis.averageTicket) },
        {
          label: "Efectivo esperado",
          value: formatCurrency(kpis.expectedCash),
        },
      ]
    : [];

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md"
        >
          <SheetHeader className="space-y-1 text-left">
            <Eyebrow>{openedAt ? `Caja · desde ${openedAt}` : "Caja"}</Eyebrow>
            <SheetTitle>Resumen del turno</SheetTitle>
            <SheetDescription>
              {registerId ? subtitle : "No hay una caja abierta."}
            </SheetDescription>
          </SheetHeader>

          {registerId && isLoading && (
            <p className="text-sm text-muted-fg">Cargando el resumen…</p>
          )}
          {kpis && (
            <>
              <div className="grid grid-cols-2 gap-2">
                {cards.map(({ label, value }) => (
                  <div
                    key={label}
                    className="min-w-0 rounded-card border border-line bg-surface-2 p-3"
                  >
                    <small className="block truncate text-xs text-muted-fg">
                      {label}
                    </small>
                    <Money className="block truncate text-lg font-bold text-fg">
                      {value}
                    </Money>
                  </div>
                ))}
              </div>
              <section className="space-y-2 rounded-card border border-line p-3">
                <h3 className="text-sm font-semibold text-fg">
                  Ventas por método
                </h3>
                {kpis.methods.length === 0 ? (
                  <p className="text-sm text-muted-fg">
                    Aún no hay pagos en este turno.
                  </p>
                ) : (
                  <ul
                    aria-label="Ventas por método"
                    className="space-y-1 text-sm"
                  >
                    {kpis.methods.map((m) => (
                      <li
                        key={m.paymentMethodId}
                        className="flex justify-between gap-3"
                      >
                        <span className="min-w-0 truncate">{m.name}</span>
                        <Money>{formatCurrency(m.total)}</Money>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              {summary && (
                <section
                  aria-label="Arqueo de efectivo"
                  className="space-y-1 rounded-card border border-line p-3 text-sm"
                >
                  <h3 className="mb-1 text-sm font-semibold text-fg">
                    Arqueo de efectivo
                  </h3>
                  <div className="flex justify-between gap-3">
                    <span>Base inicial</span>
                    <Money>{formatCurrency(summary.initialCash)}</Money>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>Ingresos / retiros</span>
                    <Money>
                      +{formatCurrency(summary.cashDeposits)} / −
                      {formatCurrency(summary.cashWithdrawals)}
                    </Money>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>Propinas a meseros</span>
                    <Money>−{formatCurrency(summary.tipsPayout)}</Money>
                  </div>
                  <div className="flex justify-between gap-3 border-t border-line pt-1 text-base font-bold text-fg">
                    <span>Esperado después de propinas</span>
                    <Money>
                      {formatCurrency(summary.expectedCashAfterTips)}
                    </Money>
                  </div>
                  <div className="space-y-1 pt-2">
                    <Label htmlFor="shift-counted-cash">Efectivo contado</Label>
                    <Input
                      id="shift-counted-cash"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="Opcional"
                      value={counted}
                      onChange={(e) =>
                        setCounted(e.target.value.replace(/[^\d]/g, ""))
                      }
                      className="h-11 text-right tabular-nums"
                    />
                  </div>
                  {difference !== null && (
                    <p
                      role="status"
                      className={
                        difference === 0
                          ? "font-semibold text-status-ok-fg"
                          : difference > 0
                            ? "font-semibold text-status-warning-fg"
                            : "font-semibold text-status-danger-fg"
                      }
                    >
                      {difference === 0 ? (
                        "Cuadra"
                      ) : (
                        <>
                          {difference > 0 ? "Sobra " : "Falta "}
                          <Money>{formatCurrency(Math.abs(difference))}</Money>
                        </>
                      )}
                    </p>
                  )}
                </section>
              )}
            </>
          )}

          <div className="mt-auto flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="h-11 flex-1"
              onClick={onShowMovements}
            >
              Movimientos de caja
            </Button>
            {registerId && (
              <Button
                className="h-11 flex-1"
                onClick={() => {
                  onOpenChange(false);
                  setCloseOpen(true);
                }}
              >
                Ir al cierre de caja
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <CloseRegisterDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        onSuccess={refreshSummary}
      />
    </>
  );
}
