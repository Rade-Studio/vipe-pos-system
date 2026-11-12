"use client"

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { FlaskConical } from "lucide-react"
import { EmptyState } from "@/components/admin/common/EmptyState"
import { PageHeader } from "@/components/admin/common/PageHeader"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useFormulas, useInventoryItems } from "@/hooks/inventory"
import { cn } from "@/lib/utils"
import { DailySheet } from "./DailySheet"
import { LotsTab } from "./LotsTab"
import { PrepTable } from "./PrepTable"
import { toFormulaItem } from "./production-plan"

interface ProductionPageProps {
  description: string
  onNavigate?: (sectionId: string) => void
}

const TABS = ["preps", "day", "lots"] as const
type Tab = (typeof TABS)[number]

/**
 * Producción (odd/tasks/produccion-diaria.md, S1): preparations, the daily
 * production sheet and the lots, as three tabs. A tab stays mounted once
 * visited so typed quantities survive switching.
 */
export function ProductionPage({ description, onNavigate }: ProductionPageProps) {
  const itemsQuery = useInventoryItems()
  const formulasQuery = useFormulas()
  const [tab, setTab] = useState<Tab>("preps")
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set(["preps"]))
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ preps: null, day: null, lots: null })
  const baseId = useId()

  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data])
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, toFormulaItem(item)])), [items])
  const byPrep = formulasQuery.data?.byPrep ?? {}
  const preps = useMemo(() => items.filter((item) => item.kind === "prep" && item.isActive), [items])
  const allPreps = useMemo(() => items.filter((item) => item.kind === "prep"), [items])
  const loading = itemsQuery.isLoading || formulasQuery.isLoading

  const select = (next: Tab, focus = false) => {
    setTab(next)
    setVisited((current) => (current.has(next) ? current : new Set([...current, next])))
    if (focus) tabRefs.current[next]?.focus()
  }

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const i = TABS.indexOf(tab)
    const j =
      event.key === "ArrowRight" ? i + 1 : event.key === "ArrowLeft" ? i - 1 : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : null
    if (j === null) return
    event.preventDefault()
    select(TABS[(j + TABS.length) % TABS.length], true)
  }

  const labels: Record<Tab, string> = {
    preps: `Preparaciones (${preps.length})`,
    day: "Registrar producción del día",
    lots: "Lotes",
  }
  const tabId = (t: Tab) => `${baseId}-tab-${t}`
  const panelId = (t: Tab) => `${baseId}-panel-${t}`

  return (
    <div className="space-y-4">
      <PageHeader title="Producción" description={description} />

      <div role="tablist" aria-label="Secciones de producción" className="flex gap-1 overflow-x-auto border-b">
        {TABS.map((t) => (
          <button
            key={t}
            ref={(el) => {
              tabRefs.current[t] = el
            }}
            type="button"
            role="tab"
            id={tabId(t)}
            aria-selected={tab === t}
            aria-controls={panelId(t)}
            tabIndex={tab === t ? 0 : -1}
            onClick={() => select(t)}
            onKeyDown={onTabKey}
            className={cn(
              "-mb-px inline-flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 border-transparent px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab === t && "border-primary text-foreground",
            )}
          >
            {labels[t]}
          </button>
        ))}
      </div>

      {TABS.map((t) => (
        <section key={t} role="tabpanel" id={panelId(t)} aria-labelledby={tabId(t)} hidden={tab !== t} tabIndex={-1}>
          {visited.has(t) &&
            (loading && t !== "lots" ? (
              <Skeleton className="h-64" />
            ) : t !== "lots" && preps.length === 0 ? (
              <EmptyState
                icon={FlaskConical}
                title="Sin preparaciones"
                description="Crea una preparación (salsa, pico de gallo…) desde Fórmulas para producirla por lotes."
                action={
                  onNavigate && (
                    <Button variant="outline" className="min-h-11" onClick={() => onNavigate("formulas")}>
                      Ir a Fórmulas
                    </Button>
                  )
                }
              />
            ) : t === "preps" ? (
              <PrepTable preps={preps} byPrep={byPrep} itemsById={itemsById} onNavigate={onNavigate} onDailySheet={() => select("day", true)} />
            ) : t === "day" ? (
              <DailySheet preps={preps} byPrep={byPrep} itemsById={itemsById} />
            ) : (
              <LotsTab preps={allPreps} />
            ))}
        </section>
      ))}
    </div>
  )
}
