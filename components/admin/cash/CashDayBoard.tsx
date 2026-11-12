"use client"

import { Loader2 } from "lucide-react"
import { Panel } from "@/components/admin/common/Panel"
import { StatCard } from "@/components/admin/common/StatCard"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { CashDay, CashDayRegister } from "@/lib/api/cash"
import {
  DIFFERENCE_TONE_CLASS,
  differenceStatus,
  formatCop,
  formatPercentChange,
  formatShortDay,
  formatSignedCop,
  formatTime,
} from "@/lib/admin/cash"
import { cn } from "@/lib/utils"
import { Region } from "./Segmented"

export function turnoLabel(day: CashDay, registerId: string | null): string {
  const index = day.registers.findIndex((register) => register.id === registerId)
  if (index < 0) return "Fuera de turno"
  return `Turno ${index + 1} · ${day.registers[index].openedBy?.name ?? "Sin cajero"}`
}

function Money({ value, className }: { value: number; className?: string }) {
  return <span className={cn("tabular-nums", className)}>{formatCop(value)}</span>
}

function Difference({ value }: { value: number | null }) {
  const status = differenceStatus(value)
  return (
    <span className={cn("flex flex-wrap items-baseline justify-end gap-x-2 font-medium", DIFFERENCE_TONE_CLASS[status.tone])}>
      <span>{status.label}</span>
      {value !== null && <span className="tabular-nums">{formatSignedCop(value)}</span>}
    </span>
  )
}

export function DayKpis({ day }: { day: CashDay }) {
  const { totals, previous } = day
  const change = formatPercentChange(totals.salesNet, previous.salesNet)
  return (
    <Region label="Indicadores del día" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <StatCard
        title="Ventas netas"
        value={formatCop(totals.salesNet)}
        hint={
          change
            ? `${change} vs ${formatShortDay(previous.date)} (${formatCop(previous.salesNet)})`
            : `Sin ventas el ${formatShortDay(previous.date)} para comparar`
        }
      />
      <StatCard
        title="Tiquetes"
        value={totals.tickets}
        hint={day.registers.map((register, i) => `Turno ${i + 1}: ${register.tickets}`).join(" · ") || undefined}
      />
      <StatCard title="Ticket promedio" value={formatCop(totals.avgTicket)} hint="Ventas netas ÷ tiquetes" />
      <StatCard
        title="Mesas atendidas"
        value={totals.tables}
        hint={`+ ${totals.deliveries.count} domicilios (${formatCop(totals.deliveries.amount)}) · ${totals.takeaway?.count ?? 0} para llevar (${formatCop(totals.takeaway?.amount ?? 0)})`}
      />
      <StatCard
        title="Cuadre del día"
        value={<span className={DIFFERENCE_TONE_CLASS[differenceStatus(totals.difference).tone]}>{formatSignedCop(totals.difference)}</span>}
        hint={`Esperado ${formatCop(totals.expected)} · contado ${formatCop(totals.counted)}`}
      />
    </Region>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  )
}

interface TurnoCardProps {
  index: number
  register: CashDayRegister
  validating: boolean
  onValidate: (id: string) => void
}

function TurnoCard({ index, register, validating, onValidate }: TurnoCardProps) {
  const cashier = register.openedBy?.name ?? "Sin cajero"
  const label = `Turno ${index + 1} · ${cashier}`
  const open = register.status === "open"
  return (
    <article aria-label={label} className="min-w-0 rounded-lg border bg-card p-4 text-card-foreground">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{label}</h3>
        {open ? (
          <Badge variant="warning">Turno abierto</Badge>
        ) : register.validatedBy ? (
          <Badge variant="secondary">Validado</Badge>
        ) : (
          <Badge variant="outline">Por validar</Badge>
        )}
      </header>
      <dl className="mt-3 text-sm">
        <Row label="Apertura">
          {formatTime(register.openedAt)} · fondo <Money value={register.initialCash} />
        </Row>
        <Row label="Cierre">
          {open ? "En curso" : `${formatTime(register.closedAt)} · cerró ${register.closedBy?.name ?? "—"}`}
        </Row>
        <Row label="Ventas">
          <Money value={register.salesNet} /> · {register.tickets} tiquetes
        </Row>
      </dl>
      <dl className="mt-3 rounded-md bg-muted/50 px-3 py-2 text-sm">
        <Row label="Esperado">
          <Money value={register.expected} />
        </Row>
        <Row label="Contado">{register.countedCash === null ? "—" : <Money value={register.countedCash} />}</Row>
        <Row label="Diferencia">
          <Difference value={open ? null : register.cashDifference} />
        </Row>
      </dl>
      {register.closeNote && (
        <p className="mt-3 text-sm">
          <span className="text-muted-foreground">Nota: </span>
          <span>{register.closeNote}</span>
        </p>
      )}
      <div className="mt-3 text-sm">
        {register.validatedBy ? (
          <p className="text-muted-foreground">
            Validó {register.validatedBy.name} · {formatTime(register.validatedAt)}
          </p>
        ) : (
          !open && (
            <Button className="min-h-11 w-full sm:w-auto" onClick={() => onValidate(register.id)} disabled={validating}>
              {validating && <Loader2 className="animate-spin" aria-hidden />}
              Validar turno
            </Button>
          )
        )}
      </div>
    </article>
  )
}

/** Fondo + efectivo de ventas + entradas − salidas − propinas pagadas = esperado. */
function DrawerMoney({ day }: { day: CashDay }) {
  const rows = day.registers.map((register) => ({
    register,
    cashSales: register.expected - register.initialCash - register.deposits + register.withdrawals + register.tipsPayout,
  }))
  const lines: { label: string; value: (row: (typeof rows)[number]) => React.ReactNode }[] = [
    { label: "Fondo de caja", value: (r) => formatCop(r.register.initialCash) },
    { label: "Efectivo de ventas", value: (r) => `+ ${formatCop(r.cashSales)}` },
    { label: "Entradas", value: (r) => `+ ${formatCop(r.register.deposits)}` },
    { label: "Salidas", value: (r) => `− ${formatCop(r.register.withdrawals)}` },
    { label: "Propinas pagadas", value: (r) => `− ${formatCop(r.register.tipsPayout)}` },
    { label: "Esperado", value: (r) => <strong>{formatCop(r.register.expected)}</strong> },
    { label: "Contado", value: (r) => (r.register.countedCash === null ? "—" : formatCop(r.register.countedCash)) },
    {
      label: "Diferencia",
      value: (r) => <Difference value={r.register.status === "open" ? null : r.register.cashDifference} />,
    },
  ]
  return (
    <Region label="Dinero del cajón">
      <Panel title="Dinero del cajón" description="Solo efectivo. Cómo se llega al esperado." contentClassName="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th scope="col" className="px-4 py-2 font-medium">
                Concepto
              </th>
              {rows.map((r, i) => (
                <th key={r.register.id} scope="col" className="px-4 py-2 text-right font-medium">
                  Turno {i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.label} className="border-b last:border-0">
                <th scope="row" className="px-4 py-2 text-left font-normal">
                  {line.label}
                </th>
                {rows.map((r) => (
                  <td key={r.register.id} className="px-4 py-2 text-right tabular-nums">
                    {line.value(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </Region>
  )
}

export function MethodTotals({ methods, salesNet }: { methods: CashDay["totals"]["methods"]; salesNet: number }) {
  const sum = methods.reduce((acc, method) => acc + method.total, 0)
  return (
    <Region label="Ventas por método de pago">
      <Panel title="Ventas por método de pago" description="Todos los métodos, incluidos los que no se usaron.">
        <ul className="space-y-2 text-sm">
          {methods.map((method) => (
            <li key={method.id} className="flex items-baseline justify-between gap-3">
              <span>
                <span className="font-medium">{method.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {method.count} {method.count === 1 ? "cobro" : "cobros"}
                  {sum > 0 && ` · ${((method.total / sum) * 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })} %`}
                </span>
              </span>
              <Money value={method.total} />
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
          Ventas netas {formatCop(salesNet)}. Los métodos suman lo cobrado con propinas; no incluyen entradas ni salidas de efectivo.
        </p>
      </Panel>
    </Region>
  )
}

export function WaiterTips({ tips, total }: { tips: CashDay["tipsByWaiter"]; total: number }) {
  return (
    <Region label="Propinas (no son ingreso del restaurante)">
      <Panel
        title="Propinas (no son ingreso del restaurante)"
        description="Voluntarias (Ley 1935 de 2018), por mesero. No suman a ventas ni a la base del impuesto."
      >
        {tips.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin propinas.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {tips.map((tip) => (
              <li key={tip.waiterId ?? "none"} className="flex items-baseline justify-between gap-3">
                <span>{tip.name ?? "Sin mesero"}</span>
                <Money value={tip.amount} />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 flex justify-between border-t pt-3 text-sm font-medium">
          <span>Total propinas</span>
          <Money value={total} />
        </p>
      </Panel>
    </Region>
  )
}

const VOID_KIND: Record<CashDay["voids"]["items"][number]["kind"], string> = {
  payment_void: "Cobro anulado",
  order_cancellation: "Orden cancelada",
  item_void: "Plato anulado",
}

function Voids({ voids }: { voids: CashDay["voids"] }) {
  return (
    <Region label="Anulaciones y cancelaciones">
      <Panel
        title="Anulaciones y cancelaciones"
        description={`${voids.count} por ${formatCop(voids.amount)} · nada se borra, todo queda auditado`}
      >
        {voids.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin anulaciones este día.</p>
        ) : (
          <ul className="divide-y text-sm">
            {voids.items.map((item, i) => (
              <li key={`${item.at}-${i}`} className="grid gap-1 py-2 sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:gap-3">
                <span className="text-muted-foreground">{formatTime(item.at)}</span>
                <span className="min-w-0">
                  <span className="block font-medium">
                    {[item.orderNumber !== null ? `Orden #${item.orderNumber}` : null, item.table ? (item.table === "Domicilio" ? item.table : `Mesa ${item.table}`) : null]
                      .filter(Boolean)
                      .join(" · ") || VOID_KIND[item.kind]}
                  </span>
                  <span className="block text-muted-foreground">{VOID_KIND[item.kind]}</span>
                  <span className="block">{item.reasonText || item.reason}</span>
                  <span className="block text-muted-foreground">
                    Pidió {item.requestedBy}
                    {item.authorizedBy ? ` · Autorizó ${item.authorizedBy}` : ""}
                  </span>
                </span>
                <Money value={item.amount} className="sm:text-right" />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </Region>
  )
}

interface CashDayBoardProps {
  day: CashDay
  validatingId: string | null
  onValidate: (id: string) => void
}

/** Tablero del día (design 02). */
export function CashDayBoard({ day, validatingId, onValidate }: CashDayBoardProps) {
  return (
    <div className="flex flex-col gap-4">
      <DayKpis day={day} />
      <div className="grid gap-4 md:grid-cols-2">
        {day.registers.map((register, i) => (
          <TurnoCard
            key={register.id}
            index={i}
            register={register}
            validating={validatingId === register.id}
            onValidate={onValidate}
          />
        ))}
      </div>
      <DrawerMoney day={day} />
      <div className="grid gap-4 lg:grid-cols-2">
        <MethodTotals methods={day.totals.methods} salesNet={day.totals.salesNet} />
        <WaiterTips tips={day.tipsByWaiter} total={day.totals.tips} />
      </div>
      <Voids voids={day.voids} />
    </div>
  )
}
