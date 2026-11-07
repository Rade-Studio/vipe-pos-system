"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Download } from "lucide-react"
import { Chip, Eyebrow, Money, focusRing, type ChipTone } from "@/components/cashier/cashier-ui"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/utils/helpers"
import { getAuditEvents, type AuditEventType, type AuditFilter } from "@/lib/api/audit"
import { listStaff } from "@/lib/api/staff"
import { listPaymentMethods } from "@/lib/api/payments"
import { localDayKey } from "@/lib/admin/dates"
import { AUDIT_TYPE_LABEL, auditCsv, auditReason, auditSubject, auditTotals, clock, plural } from "@/lib/admin/voids"

const TYPE_TONE: Record<AuditEventType, ChipTone> = {
  order_cancelled: "danger",
  items_voided: "kitchen",
  payment_voided: "served",
}

const FIELD = cn("h-11 min-w-0 rounded-lg border border-line-strong bg-surface px-3 text-sm text-fg", focusRing)
const TH = "px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-fg"
const TD = "px-3 py-3 align-top text-sm text-fg"

/**
 * F3 — admin "Anulaciones" (design/anulaciones/01, vista auditoria): every
 * cancellation and void from GET /audit with its reason, who asked and who
 * authorized, filtered on the server; totals cards and CSV of what is listed.
 */
export function VoidsPage({ description }: { description: string }) {
  const today = localDayKey(new Date())
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [type, setType] = useState<AuditEventType | "">("")
  const [actorId, setActorId] = useState("")
  const [authorizerId, setAuthorizerId] = useState("")
  const [onlySelf, setOnlySelf] = useState(false)

  const filter: AuditFilter = {
    from,
    to,
    ...(type ? { types: [type] } : {}),
    ...(actorId ? { actorId } : {}),
    ...(authorizerId ? { authorizerId } : {}),
    ...(onlySelf ? { selfAuthorized: true } : {}),
  }
  const events = useQuery({ queryKey: ["audit", filter], queryFn: () => getAuditEvents(filter) })
  const staff = useQuery({ queryKey: ["staff"], queryFn: listStaff })
  const methods = useQuery({ queryKey: ["payment-methods", "audit"], queryFn: () => listPaymentMethods() })
  const methodName = (code: string) => methods.data?.find((method) => method.code === code)?.name ?? code
  const list = useMemo(() => events.data ?? [], [events.data])
  const totals = useMemo(() => auditTotals(list), [list])
  const people = staff.data ?? []
  const supervisors = people.filter((member) => member.role === "admin" || member.role === "cashier")

  const exportCsv = () => {
    // A BOM so a spreadsheet opens the accents right.
    const blob = new Blob(["\uFEFF" + auditCsv(list, methodName)], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `anulaciones-${from}${to !== from ? `-a-${to}` : ""}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const cards = [
    { label: "Órdenes canceladas", amount: totals.cancelled.amount, note: plural(totals.cancelled.count, "orden", "órdenes"), warn: false },
    { label: "Platos anulados", amount: totals.items.amount, note: plural(totals.items.units, "plato", "platos"), warn: false },
    { label: "Pagos anulados", amount: totals.payments.amount, note: plural(totals.payments.count, "pago", "pagos"), warn: false },
    { label: "Autoautorizadas", amount: totals.selfAuthorized.amount, note: plural(totals.selfAuthorized.count, "registro", "registros"), warn: true },
  ]

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <Eyebrow className="text-brand-strong tracking-[0.2em]">Órdenes</Eyebrow>
          <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">Anulaciones</h1>
          <p className="text-sm text-muted-fg">{description}</p>
        </div>
        <Button variant="outline" className="min-h-[44px]" onClick={exportCsv} disabled={list.length === 0}>
          <Download aria-hidden className="mr-2 h-4 w-4" />
          Exportar CSV
        </Button>
      </div>

      <div role="group" aria-label="Filtros" className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs font-semibold text-muted-fg">
          Desde
          <input type="date" className={FIELD} value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-muted-fg">
          Hasta
          <input type="date" className={FIELD} value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </label>
        <select aria-label="Tipo" className={FIELD} value={type} onChange={(e) => setType(e.target.value as AuditEventType | "")}>
          <option value="">Todos los tipos</option>
          {(Object.keys(AUDIT_TYPE_LABEL) as AuditEventType[]).map((key) => (
            <option key={key} value={key}>
              {AUDIT_TYPE_LABEL[key]}
            </option>
          ))}
        </select>
        <select aria-label="Pidió" className={FIELD} value={actorId} onChange={(e) => setActorId(e.target.value)}>
          <option value="">Pidió: todos</option>
          {people.map((member) => (
            <option key={member.id} value={member.id}>
              {member.fullName}
            </option>
          ))}
        </select>
        <select aria-label="Autorizó" className={FIELD} value={authorizerId} onChange={(e) => setAuthorizerId(e.target.value)}>
          <option value="">Autorizó: todos</option>
          {supervisors.map((member) => (
            <option key={member.id} value={member.id}>
              {member.fullName}
            </option>
          ))}
        </select>
        <button
          type="button"
          role="switch"
          aria-checked={onlySelf}
          onClick={() => setOnlySelf((value) => !value)}
          className={cn(
            "inline-flex h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium",
            onlySelf ? "border-status-warning-line bg-status-warning-bg text-status-warning-fg" : "border-line-strong text-fg",
            focusRing,
          )}
        >
          <span aria-hidden className={cn("h-4 w-7 rounded-full p-0.5", onlySelf ? "bg-status-warning-fg" : "bg-line-strong")}>
            <span className={cn("block h-3 w-3 rounded-full bg-surface transition-transform", onlySelf && "translate-x-3")} />
          </span>
          Solo autoautorizadas
        </button>
      </div>

      <ul aria-label="Totales" className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <li
            key={card.label}
            className={cn(
              "rounded-card border p-4",
              card.warn ? "border-status-warning-line bg-status-warning-bg text-status-warning-fg" : "border-line bg-surface",
            )}
          >
            <small className={cn("block text-xs font-semibold", card.warn ? "" : "text-muted-fg")}>{card.label}</small>
            <Money className="mt-1 block text-xl font-bold">{formatCurrency(card.amount)}</Money>
            <span className={cn("text-xs", card.warn ? "" : "text-muted-fg")}>{card.note}</span>
          </li>
        ))}
      </ul>

      <section className="min-w-0 overflow-x-auto rounded-card border border-line bg-surface shadow-sm">
        {events.isLoading ? (
          <div className="space-y-3 p-4" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : events.isError ? (
          <p className="p-4 text-sm text-status-danger-fg">No se pudieron cargar las anulaciones.</p>
        ) : list.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="font-bold text-fg">No hay anulaciones con estos filtros.</p>
            <p className="mt-1 text-sm text-muted-fg">Cada cancelación o anulación queda aquí con su motivo y quién la autorizó.</p>
          </div>
        ) : (
          <>
            <table className="w-full min-w-[820px] border-collapse" aria-label="Anulaciones">
              <thead>
                <tr className="border-b border-line">
                  <th className={TH}>Hora</th>
                  <th className={TH}>Tipo</th>
                  <th className={TH}>Orden</th>
                  <th className={TH}>Motivo</th>
                  <th className={TH}>Pidió</th>
                  <th className={TH}>Autorizó</th>
                  <th className={`${TH} text-right`}>Monto</th>
                </tr>
              </thead>
              <tbody>
                {list.map((event) => {
                  const subject = auditSubject(event, methodName)
                  return (
                    <tr key={event.id} className="border-b border-line last:border-0">
                      <td className={`${TD} tabular-nums`}>
                        {clock(event.createdAt)}
                        {from !== to && <small className="block text-xs text-muted-fg">{localDayKey(new Date(event.createdAt))}</small>}
                      </td>
                      <td className={TD}>
                        <Chip tone={TYPE_TONE[event.eventType]}>{AUDIT_TYPE_LABEL[event.eventType]}</Chip>
                      </td>
                      <td className={TD}>
                        <b className="tabular-nums">{subject.title}</b>
                        {event.orderType === "delivery" && (
                          <Chip tone="reserved" className="ml-1.5">
                            Domicilio
                          </Chip>
                        )}
                        {subject.detail && <small className="block break-words text-xs text-muted-fg">{subject.detail}</small>}
                        {event.orderType === "delivery" && typeof event.details.customer_name === "string" && (
                          <small className="block break-words text-xs text-muted-fg">{event.details.customer_name}</small>
                        )}
                      </td>
                      <td className={`${TD} max-w-[16rem] break-words`}>{auditReason(event)}</td>
                      <td className={TD}>{event.actor.name}</td>
                      <td className={TD}>
                        <span className="block">{event.authorizedBy?.name ?? <span className="text-muted-fg">No hizo falta</span>}</span>
                        {event.selfAuthorized && (
                          <Chip tone="warning" className="mt-1">
                            Autoautorizada
                          </Chip>
                        )}
                      </td>
                      <td className={`${TD} text-right`}>
                        <Money>−{formatCurrency(event.amount)}</Money>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="px-3 py-2.5 text-xs text-muted-fg">
              {plural(list.length, "registro", "registros")} · los montos anulados no cuentan en ventas ni en caja.
            </p>
          </>
        )}
      </section>
    </div>
  )
}
