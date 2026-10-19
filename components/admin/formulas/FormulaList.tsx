"use client"

import { Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { segmentedListClass, segmentedTriggerClass } from "@/components/admin/common/Panel"
import { MarginBadge, formatMoney } from "@/components/admin/inventory-shared"
import { cn } from "@/lib/utils"

export interface FormulaListRow {
  id: string
  type: "dish" | "prep"
  name: string
  /** Null when the target has no formula yet. */
  cost: number | null
  /** Dishes with a price only. */
  marginPct: number | null
  unit?: string
  dirty?: boolean
}

interface FormulaListProps {
  tab: "dish" | "prep"
  onTabChange: (tab: "dish" | "prep") => void
  search: string
  onSearchChange: (value: string) => void
  rows: FormulaListRow[]
  selectedId: string | null
  onSelect: (row: FormulaListRow) => void
  isLoading?: boolean
  counts: { dish: number; prep: number }
}

export function FormulaList({
  tab,
  onTabChange,
  search,
  onSearchChange,
  rows,
  selectedId,
  onSelect,
  isLoading,
  counts,
}: FormulaListProps) {
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <Tabs value={tab} onValueChange={(value) => onTabChange(value as "dish" | "prep")}>
        <TabsList className={segmentedListClass} aria-label="Tipo de fórmula">
          <TabsTrigger value="dish" className={segmentedTriggerClass}>
            Platos <span className="ml-1.5 text-xs text-muted-foreground">{counts.dish}</span>
          </TabsTrigger>
          <TabsTrigger value="prep" className={segmentedTriggerClass}>
            Preparaciones <span className="ml-1.5 text-xs text-muted-foreground">{counts.prep}</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={tab === "dish" ? "Buscar plato…" : "Buscar preparación…"}
          aria-label={tab === "dish" ? "Buscar plato" : "Buscar preparación"}
          className="pl-8"
        />
      </div>
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {tab === "dish" ? "No hay platos" : "Aún no hay preparaciones. Créalas desde una fórmula."}
        </p>
      ) : (
        <ul className="-mx-1 space-y-0.5 overflow-y-auto px-1 md:max-h-[calc(100vh-16rem)]" aria-label="Fórmulas">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => onSelect(row)}
                aria-current={row.id === selectedId ? "true" : undefined}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent",
                  row.id === selectedId && "bg-accent",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {row.name}
                    {row.dirty && (
                      <span className="ml-1 text-primary" aria-label="Cambios sin guardar">
                        •
                      </span>
                    )}
                  </span>
                  {row.cost !== null && (
                    <span className="block text-xs tabular-nums text-muted-foreground">
                      {formatMoney(row.cost)}
                      {row.type === "prep" && row.unit ? ` / ${row.unit}` : ""}
                    </span>
                  )}
                </span>
                {row.cost === null ? (
                  <Badge variant="outline" className="shrink-0 font-normal text-muted-foreground">
                    Sin fórmula
                  </Badge>
                ) : (
                  row.marginPct !== null && <MarginBadge marginPct={row.marginPct} className="shrink-0" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
