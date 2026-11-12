"use client"

import { Fragment, useState } from "react"
import { ChevronUp, Plus } from "lucide-react"
import { formatMoney } from "@/components/admin/inventory-shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formulaCost, type FormulaItem } from "@/lib/inventory/formula"
import { rowMax } from "@/lib/inventory/production-sheet"
import { formatQuantity } from "@/lib/inventory/units"
import type { Formula, InventoryItem } from "@/lib/api/inventory/types"
import { cn } from "@/lib/utils"
import { ProduceForm } from "./ProduceForm"
import { matchesPrep, PrepFilters, PrepStatusBadge, prepStatus, sortPreps, type StatusFilter } from "./production-ui"

interface PrepTableProps {
  preps: InventoryItem[]
  byPrep: Record<string, Formula | undefined>
  itemsById: Map<string, FormulaItem>
  onNavigate?: (sectionId: string) => void
  onDailySheet: () => void
}

const BAR = { out: "bg-destructive", low: "bg-yellow-500", ok: "bg-emerald-500" } as const

/** S2: one compact row per active preparation, Agotadas and Bajas first, with an inline Producir. */
export function PrepTable({ preps, byPrep, itemsById, onNavigate, onDailySheet }: PrepTableProps) {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<StatusFilter>("all")
  const [openId, setOpenId] = useState<string | null>(null)
  const list = sortPreps(preps).filter((prep) => matchesPrep(prep, query, status))

  return (
    <div className="space-y-3">
      <PrepFilters
        preps={preps}
        query={query}
        status={status}
        onQuery={setQuery}
        onStatus={setStatus}
        label="Filtrar preparaciones por estado"
      />
      <div className="rounded-lg border bg-card">
        <table
          className="block w-full text-sm md:table"
          aria-label="Preparaciones: estado, stock, cuánto se puede producir y costo por unidad"
        >
          <thead className="hidden md:table-header-group">
            <tr className="text-xs text-muted-foreground">
              {["Preparación", "Estado", "Stock · se puede producir", "Costo por unidad"].map((label, i) => (
                <th
                  key={label}
                  scope="col"
                  className={cn("sticky top-0 z-10 h-10 border-b bg-card px-3 text-left font-medium", i === 3 && "text-right")}
                >
                  {label}
                </th>
              ))}
              <th scope="col" className="sticky top-0 z-10 h-10 w-px border-b bg-card px-3">
                <span className="sr-only">Acción</span>
              </th>
            </tr>
          </thead>
          <tbody className="block md:table-row-group">
            {list.length === 0 ? (
              <tr className="block md:table-row">
                <td colSpan={5} className="block px-3 py-6 text-center text-muted-foreground md:table-cell">
                  Ninguna preparación coincide{query.trim() ? ` con “${query.trim()}”` : ""}.{" "}
                  <Button
                    variant="ghost"
                    className="min-h-11"
                    onClick={() => {
                      setQuery("")
                      setStatus("all")
                    }}
                  >
                    Ver todas
                  </Button>
                </td>
              </tr>
            ) : (
              list.map((prep) => {
                const formula = byPrep[prep.id]
                const hasFormula = Boolean(formula && formula.lines.length > 0)
                const max = hasFormula ? rowMax(formula, itemsById) : 0
                const unitCost = formula ? formulaCost(formula.lines, itemsById, formula.yieldQuantity).perUnit : 0
                const open = openId === prep.id
                const total = Math.max(prep.stock, 0) + max || 1
                return (
                  <Fragment key={prep.id}>
                    <tr
                      className={cn(
                        "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b px-3 py-2.5 md:table-row md:p-0",
                        open && "bg-primary/5",
                      )}
                    >
                      <td className="block min-w-0 md:table-cell md:px-3 md:py-1.5">
                        <span className="block truncate font-medium">{prep.name}</span>
                        <span className="block font-mono text-xs text-muted-foreground">{prep.sku}</span>
                      </td>
                      <td className="block justify-self-end md:table-cell md:px-3 md:py-1.5">
                        <PrepStatusBadge item={prep} />
                      </td>
                      <td className="col-span-2 block md:table-cell md:px-3 md:py-1.5">
                        <div className="grid gap-1 md:min-w-44">
                          <span aria-hidden className="flex h-1.5 overflow-hidden rounded-full border bg-muted">
                            <b className={BAR[prepStatus(prep)]} style={{ width: `${(Math.max(prep.stock, 0) / total) * 100}%` }} />
                            <s className="bg-primary/30" style={{ width: `${(max / total) * 100}%` }} />
                          </span>
                          <small className="text-xs text-muted-foreground">
                            <b className="font-semibold tabular-nums text-foreground">{formatQuantity(prep.stock, prep.unit)}</b>
                            {" · "}
                            {!hasFormula ? (
                              "sin fórmula"
                            ) : max > 0 ? (
                              <span className="tabular-nums">puedes producir {formatQuantity(max, prep.unit)}</span>
                            ) : (
                              <span className="text-destructive">faltan insumos</span>
                            )}
                          </small>
                        </div>
                      </td>
                      <td className="col-span-2 block tabular-nums md:table-cell md:px-3 md:py-1.5 md:text-right">
                        {hasFormula ? (
                          <>
                            {formatMoney(unitCost)} <span className="text-muted-foreground">/ {prep.unit}</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="col-span-2 mt-1 block md:mt-0 md:table-cell md:w-px md:px-3 md:py-1.5 md:text-right">
                        {hasFormula ? (
                          <Button
                            variant="outline"
                            className="min-h-11 w-full md:w-auto"
                            aria-expanded={open}
                            aria-label={`Producir ${prep.name}`}
                            onClick={() => setOpenId(open ? null : prep.id)}
                          >
                            {open ? <ChevronUp aria-hidden /> : <Plus aria-hidden />}
                            Producir
                          </Button>
                        ) : (
                          <span className="flex items-center justify-between gap-2 md:justify-end">
                            <Badge variant="outline">Sin fórmula</Badge>
                            {onNavigate && (
                              <Button variant="outline" className="min-h-11" onClick={() => onNavigate("formulas")}>
                                Crear fórmula
                              </Button>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                    {open && formula && (
                      <tr className="block border-b bg-primary/5 md:table-row">
                        <td colSpan={5} className="block p-3 md:table-cell">
                          <ProduceForm prep={prep} formula={formula} itemsById={itemsById} onDone={() => setOpenId(null)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span aria-live="polite">
          {list.length === preps.length
            ? `Mostrando las ${preps.length} preparaciones · agotadas y bajas primero`
            : `Mostrando ${list.length} de ${preps.length} preparaciones`}
        </span>
        <Button variant="ghost" className="min-h-11 whitespace-normal text-left" onClick={onDailySheet}>
          ¿Produjiste varias hoy? Registrar producción del día →
        </Button>
      </p>
    </div>
  )
}
