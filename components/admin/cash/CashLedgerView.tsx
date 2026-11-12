"use client"

import { Fragment, useMemo, useState } from "react"
import { Download } from "lucide-react"
import { EmptyState } from "@/components/admin/common/EmptyState"
import { Toolbar } from "@/components/admin/common/Panel"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import type { CashDay, CashLedger, CashLedgerEntry } from "@/lib/api/cash"
import {
  DIFFERENCE_TONE_CLASS,
  differenceStatus,
  formatCop,
  formatSignedCop,
  formatTime,
  ledgerAmount,
  ledgerCsv,
  ledgerDetail,
  ledgerKindLabel,
  ledgerMethods,
} from "@/lib/admin/cash"
import { cn } from "@/lib/utils"
import { turnoLabel } from "./CashDayBoard"
import { Region } from "./Segmented"

type KindFilter = "all" | "payments" | "movements" | "voids" | "shift"

const KIND_FILTERS: { value: KindFilter; label: string; kinds: CashLedgerEntry["kind"][] }[] = [
  { value: "all", label: "Todo", kinds: [] },
  { value: "payments", label: "Cobros", kinds: ["payment"] },
  { value: "movements", label: "Entradas y salidas", kinds: ["cash_movement"] },
  { value: "voids", label: "Anulaciones", kinds: ["payment_void", "order_cancellation"] },
  { value: "shift", label: "Apertura, cierre y validación", kinds: ["opening", "close", "validation"] },
]

const selectClass =
  "h-11 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

function downloadCsv(filename: string, csv: string) {
  if (typeof URL.createObjectURL !== "function") return
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }))
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

interface CashLedgerViewProps {
  day: CashDay
  ledger: CashLedger | undefined
  isLoading: boolean
}

/** Libro de caja (design 03): every entry grouped by turno with the running cash. */
export function CashLedgerView({ day, ledger, isLoading }: CashLedgerViewProps) {
  const [kind, setKind] = useState<KindFilter>("all")
  const [method, setMethod] = useState("all")
  const [query, setQuery] = useState("")

  const entries = useMemo(() => ledger?.entries ?? [], [ledger])
  const methodNames = useMemo(
    () => [...new Set(entries.flatMap((entry) => (entry.tenders ?? []).map((tender) => tender.method)))],
    [entries],
  )

  const groups = useMemo(() => {
    const kinds = KIND_FILTERS.find((filter) => filter.value === kind)?.kinds ?? []
    const needle = query.trim().toLowerCase()
    const visible = entries.filter((entry) => {
      if (kinds.length > 0 && !kinds.includes(entry.kind)) return false
      if (method !== "all" && !(entry.tenders ?? []).some((tender) => tender.method === method)) return false
      if (!needle) return true
      return [ledgerKindLabel(entry), ledgerDetail(entry), ledgerMethods(entry)].join(" ").toLowerCase().includes(needle)
    })
    const byRegister = new Map<string | null, CashLedgerEntry[]>()
    for (const entry of visible) {
      const list = byRegister.get(entry.registerId) ?? []
      list.push(entry)
      byRegister.set(entry.registerId, list)
    }
    return [...byRegister.entries()]
  }, [entries, kind, method, query])

  const { totals, voids } = day
  const status = differenceStatus(day.registers.some((r) => r.status === "open") ? null : totals.difference)

  return (
    <div className="flex flex-col gap-3">
      <Toolbar
        actions={
          <Button
            variant="outline"
            className="min-h-11"
            disabled={entries.length === 0}
            onClick={() => downloadCsv(`caja-${day.date}.csv`, ledgerCsv(entries, (id) => turnoLabel(day, id)))}
          >
            <Download aria-hidden />
            Exportar CSV
          </Button>
        }
      >
        <label className="sr-only" htmlFor="ledger-kind">
          Tipo
        </label>
        <select id="ledger-kind" className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as KindFilter)}>
          {KIND_FILTERS.map((filter) => (
            <option key={filter.value} value={filter.value}>
              {filter.label}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="ledger-method">
          Método
        </label>
        <select id="ledger-method" className={selectClass} value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="all">Todos los métodos</option>
          {methodNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <Input
          aria-label="Buscar en el libro"
          placeholder="Buscar mesa, orden, persona…"
          className="h-11 sm:w-64"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </Toolbar>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : entries.length === 0 ? (
        <EmptyState title="Sin movimientos en el libro" description="Este día no tiene cobros ni movimientos de efectivo." />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table aria-label="Libro de caja" className="w-full min-w-[48rem] text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                {["Hora", "Tipo", "Detalle", "Método", "Propina", "Valor", "Saldo efectivo"].map((header, i) => (
                  <th key={header} scope="col" className={cn("px-3 py-2 font-medium", i >= 4 && "text-right")}>
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    Ningún movimiento coincide con los filtros.
                  </td>
                </tr>
              )}
              {groups.map(([registerId, rows]) => (
                <Fragment key={registerId ?? "none"}>
                  <tr className="border-t bg-muted/30">
                    <th colSpan={7} scope="colgroup" className="px-3 py-2 text-left font-semibold">
                      {turnoLabel(day, registerId)}
                    </th>
                  </tr>
                  {rows.map((entry, i) => {
                    const amount = ledgerAmount(entry)
                    return (
                      <tr key={`${entry.at}-${entry.kind}-${i}`} className={cn("border-t", entry.voided && "text-muted-foreground line-through")}>
                        <td className="whitespace-nowrap px-3 py-2">{formatTime(entry.at)}</td>
                        <td className="whitespace-nowrap px-3 py-2">{ledgerKindLabel(entry)}</td>
                        <td className="px-3 py-2">{ledgerDetail(entry)}</td>
                        <td className="px-3 py-2">{ledgerMethods(entry)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{entry.tip ? formatCop(entry.tip) : ""}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{amount === null ? "" : formatCop(amount)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {entry.cashBalance === null ? "" : formatCop(entry.cashBalance)}
                        </td>
                      </tr>
                    )
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Region label="Totales del día" className="sticky bottom-0 z-10 rounded-lg border bg-card p-3 text-sm shadow-sm">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-5">
          <FooterItem label="Ventas" value={formatCop(totals.salesNet)} />
          <FooterItem label="Propinas" value={formatCop(totals.tips)} />
          <FooterItem label="Entradas" value={formatCop(totals.deposits)} />
          <FooterItem label="Salidas" value={formatCop(totals.withdrawals)} />
          <FooterItem label="Anulaciones" value={`${voids.count} · ${formatCop(voids.amount)}`} />
        </dl>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 border-t pt-2 sm:grid-cols-5">
          <FooterItem label="Efectivo esperado" value={formatCop(totals.expected)} />
          <FooterItem label="Contado" value={formatCop(totals.counted)} />
          <FooterItem
            label="Diferencia"
            value={<span className={DIFFERENCE_TONE_CLASS[status.tone]}>{`${status.label} ${formatSignedCop(totals.difference)}`}</span>}
          />
        </dl>
      </Region>
    </div>
  )
}

function FooterItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  )
}
