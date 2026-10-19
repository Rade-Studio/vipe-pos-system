"use client"

import { forwardRef, useState } from "react"
import { ChevronRight, Pencil, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { QuantityInput, formatMoney } from "@/components/admin/inventory-shared"
import { explodeFormula, type FormulaItem, type FormulaLine, type FormulaNode, type PrepFormula } from "@/lib/inventory/formula"
import { formatQuantity } from "@/lib/inventory/units"
import { cn } from "@/lib/utils"

interface FormulaLineRowProps {
  line: FormulaLine
  item: FormulaItem | undefined
  sku?: string
  cost: number
  share: number
  itemsById: Map<string, FormulaItem>
  prepFormulas: Map<string, PrepFormula>
  onQuantityChange: (quantity: number) => void
  /** Enter in the quantity field. */
  onQuantityCommit: () => void
  onRemove: () => void
  onEditPrep?: () => void
}

function TreeNodes({ nodes, depth }: { nodes: FormulaNode[]; depth: number }) {
  return (
    <ul className={cn("space-y-1", depth > 0 && "ml-4 border-l pl-3")}>
      {nodes.map((node) => (
        <li key={node.ingredientId}>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 truncate">
              {node.item?.name ?? "Artículo desconocido"}{" "}
              <span className="tabular-nums text-muted-foreground">
                {formatQuantity(node.quantity, node.item?.unit ?? "", { autoScale: true })}
              </span>
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{formatMoney(node.cost)}</span>
          </div>
          {node.children.length > 0 && <TreeNodes nodes={node.children} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  )
}

export const FormulaLineRow = forwardRef<HTMLInputElement, FormulaLineRowProps>(function FormulaLineRow(
  { line, item, sku, cost, share, itemsById, prepFormulas, onQuantityChange, onQuantityCommit, onRemove, onEditPrep },
  ref,
) {
  const [expanded, setExpanded] = useState(false)
  const name = item?.name ?? "Artículo desconocido"
  const isPrep = item?.kind === "prep"
  const subFormula = isPrep ? prepFormulas.get(line.ingredientId) : undefined
  const tree = expanded && subFormula ? explodeFormula([line], itemsById, prepFormulas)[0]?.children ?? [] : []
  const sharePct = Math.round(share * 100)

  return (
    <li className="rounded-md border p-3">
      <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_13rem_6.5rem_auto]">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {subFormula && (
              <button
                type="button"
                onClick={() => setExpanded((open) => !open)}
                aria-expanded={expanded}
                aria-label={`${expanded ? "Ocultar" : "Ver"} sub-fórmula de ${name}`}
                className="rounded p-0.5 text-muted-foreground hover:bg-accent"
              >
                <ChevronRight className={cn("h-4 w-4 transition-transform", expanded && "rotate-90")} />
              </button>
            )}
            <p className="truncate text-sm font-medium">{name}</p>
            {isPrep && (
              <Badge variant="secondary" className="shrink-0 font-normal">
                Preparación
              </Badge>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {sku}
            {item && ` · ${formatMoney(item.cost)} / ${item.unit}`}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 sm:order-last"
          onClick={onRemove}
          aria-label={`Quitar ${name}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        <QuantityInput
          ref={ref}
          value={line.quantity}
          unit={item?.unit ?? ""}
          label={`Cantidad de ${name}`}
          onChange={onQuantityChange}
          onCommit={onQuantityCommit}
          className="col-span-2 sm:col-span-1"
        />
        <div className="col-span-2 space-y-1 sm:col-span-1">
          <p className="text-right text-sm font-medium tabular-nums">{formatMoney(cost)}</p>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-muted"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={sharePct}
            aria-label={`${name}: ${sharePct} % del costo`}
          >
            <div className="h-full rounded-full bg-primary" style={{ width: `${sharePct}%` }} />
          </div>
        </div>
      </div>
      {(expanded || (isPrep && onEditPrep)) && (
        <div className="mt-2 space-y-2">
          {expanded && tree.length > 0 && (
            <div className="rounded-md bg-muted/50 p-2">
              <TreeNodes nodes={tree} depth={0} />
            </div>
          )}
          {isPrep && onEditPrep && (
            <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onEditPrep}>
              <Pencil className="mr-1 h-3 w-3" aria-hidden />
              Editar preparación
            </Button>
          )}
        </div>
      )}
    </li>
  )
})
