"use client"

import { formatMoney } from "@/components/admin/inventory-shared"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { BulkShortage, SheetSummary } from "@/lib/inventory/production-sheet"
import { formatQuantity } from "@/lib/inventory/units"
import type { InventoryItem } from "@/lib/api/inventory/types"
import { cn } from "@/lib/utils"

export interface SheetWarning {
  tone: "danger" | "warning"
  text: string
}

interface SummaryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  summary: SheetSummary
  prepsById: Map<string, InventoryItem>
  /** Lot preview per preparation ("Automático · vence 15 nov"). */
  lotPreview: (prep: InventoryItem) => string
  warnings: SheetWarning[]
  blocked: boolean
  pending: boolean
  serverError: { message: string; shortages: BulkShortage[] } | null
  onFix: () => void
  onConfirm: () => void
}

const TOP_INGREDIENTS = 5

/** S3: the lots to create, total, top ingredients and warnings before one atomic save. */
export function SummaryDialog({
  open,
  onOpenChange,
  title,
  description,
  summary,
  prepsById,
  lotPreview,
  warnings,
  blocked,
  pending,
  serverError,
  onFix,
  onConfirm,
}: SummaryDialogProps) {
  const count = summary.count
  const top = summary.ingredients.slice(0, TOP_INGREDIENTS)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {serverError && (
          <div role="alert" className="space-y-1 rounded-md border border-destructive/40 p-3 text-sm text-destructive">
            <p>{serverError.message}</p>
            <ul className="list-disc pl-5">
              {serverError.shortages.flatMap((s) =>
                s.ingredients.map((g) => (
                  <li key={`${s.itemId}-${g.ingredientId}`}>
                    {s.name || prepsById.get(s.itemId)?.name}: faltan {formatQuantity(g.missing, g.unit)} de {g.name}
                  </li>
                )),
              )}
            </ul>
          </div>
        )}

        {warnings.length > 0 && (
          <section aria-labelledby="sheet-warnings" className="space-y-2">
            <h3 id="sheet-warnings" className="text-sm font-semibold">
              Advertencias ({warnings.length})
            </h3>
            <ul className="space-y-1.5 text-sm">
              {warnings.map((w, i) => (
                <li
                  key={i}
                  className={cn(
                    "rounded-md border px-3 py-2",
                    w.tone === "danger" ? "border-destructive/40 bg-destructive/5 text-destructive" : "border-yellow-500/40 bg-yellow-500/10",
                  )}
                >
                  {w.text}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Lotes por crear</h3>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm" aria-label="Lotes por crear">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-1.5 text-left font-medium">Preparación</th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">Cantidad</th>
                  <th scope="col" className="hidden px-3 py-1.5 text-left font-medium sm:table-cell">Lote · vence</th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">Costo</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((row) => {
                  const prep = prepsById.get(row.itemId)
                  return (
                    <tr key={row.itemId} className={cn("border-t", row.exceeds && "text-destructive")}>
                      <td className="px-3 py-1.5">{prep?.name}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatQuantity(row.quantity, prep?.unit ?? "")}</td>
                      <td className="hidden px-3 py-1.5 text-muted-foreground sm:table-cell">{prep ? lotPreview(prep) : ""}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(row.cost)}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t font-semibold">
                  <td className="px-3 py-1.5">Total</td>
                  <td />
                  <td className="hidden sm:table-cell" />
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(summary.totalCost)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        {top.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Insumos que se descuentan (top {TOP_INGREDIENTS} por costo)</h3>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm" aria-label="Insumos que se descuentan">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-1.5 text-left font-medium">Insumo</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Cantidad</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Costo</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((g) => (
                    <tr key={g.ingredientId} className="border-t">
                      <td className="px-3 py-1.5">{g.name}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatQuantity(g.quantity, g.unit)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(g.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center">
          <p className="flex-1 text-sm">
            Costo total <b className="tabular-nums">{formatMoney(summary.totalCost)}</b>
            {blocked && <span className="text-destructive"> · corrige las cantidades marcadas para registrar</span>}
          </p>
          <Button variant="outline" className="min-h-11" onClick={blocked ? onFix : () => onOpenChange(false)}>
            {blocked ? "Volver y corregir" : "Seguir editando"}
          </Button>
          <Button className="min-h-11" disabled={blocked || count === 0 || pending} onClick={onConfirm}>
            {pending ? "Registrando…" : `Registrar ${count} ${count === 1 ? "lote" : "lotes"}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
