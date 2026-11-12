"use client"

import { useMemo, useState } from "react"
import { ArrowLeft, Printer } from "lucide-react"
import { PageHeader } from "@/components/admin/common/PageHeader"
import { formatMoney } from "@/components/admin/inventory-shared"
import { NativeSelect, signedClass } from "@/components/admin/stock/stock-ui"
import { CountAdjustmentPrint } from "@/components/printing/CountAdjustmentPrint"
import { CountSheetPrint, printLetter, type CountPrintHeader } from "@/components/printing/CountSheetPrint"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useRequestRecount, useSetCountReason, useStartCount } from "@/hooks/counts/use-counts"
import { useApplyCount, useCancelCount, useInventoryCategories, useInventoryItems } from "@/hooks/inventory"
import { useToast } from "@/hooks/use-toast"
import type { CountLine, InventoryCountDetail } from "@/lib/api/inventory/types"
import { formatQuantity } from "@/lib/inventory/units"
import { cn } from "@/lib/utils"
import { CountStageBadge, errorMessage } from "./count-ui"

export const COUNT_REASONS = [
  "Merma no registrada (se dañó o venció)",
  "Consumo sin venta (personal, cortesías)",
  "Error al registrar una compra",
  "Error de unidad o porción",
  "Pérdida sin explicación",
  "Otro",
]

const signedMoney = (value: number) => `${value > 0 ? "+" : ""}${formatMoney(value)}`
const signedQuantity = (value: number, unit: string) => `${value > 0 ? "+" : ""}${formatQuantity(value, unit)}`

const isBig = (line: CountLine, threshold: number) => line.reasonRequired || Math.abs(line.differenceValue ?? 0) >= threshold

interface CountReviewProps {
  count: InventoryCountDetail
  onBack: () => void
  onNavigate?: (sectionId: string) => void
}

/**
 * One assigned count through its stages (S5): start a draft, follow the
 * counting, review the differences (largest in pesos first, reason at the
 * threshold, recount per line) and apply. Prints the sheet and the record.
 */
export function CountReview({ count, onBack, onNavigate }: CountReviewProps) {
  const { toast } = useToast()
  const items = useInventoryItems().data ?? []
  const categories = useInventoryCategories().data ?? []
  const startCount = useStartCount()
  const recount = useRequestRecount()
  const setReason = useSetCountReason()
  const applyCount = useApplyCount()
  const cancelCount = useCancelCount()
  const [marked, setMarked] = useState<Set<string>>(new Set())
  const [applied, setApplied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const threshold = count.reasonThreshold
  const differences = useMemo(
    () =>
      count.lines
        .filter((l) => (l.difference ?? 0) !== 0)
        .sort((a, b) => Math.abs(b.differenceValue ?? 0) - Math.abs(a.differenceValue ?? 0)),
    [count.lines],
  )
  const counted = count.lines.filter((l) => l.countedQuantity !== null).length
  const missing = differences.filter((l) => isBig(l, threshold) && !l.notes?.trim() && !marked.has(l.id)).length
  const missingTotal = differences.reduce((s, l) => s + Math.min(l.differenceValue ?? 0, 0), 0)
  const surplusTotal = differences.reduce((s, l) => s + Math.max(l.differenceValue ?? 0, 0), 0)
  const inReview = count.stage === "review" && !applied
  const isApplied = count.stage === "applied" || applied

  const run = async (action: () => Promise<unknown>) => {
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const header: CountPrintHeader = {
    number: count.number,
    locationName: count.locationName ?? "",
    counterName: count.counterName,
    approverName: count.approverName,
    date: new Date(count.submittedAt ?? count.createdAt),
  }
  const print = (doc: React.ReactElement, title: string) => {
    if (!printLetter(doc, title)) toast({ title: "El navegador bloqueó la ventana de impresión", variant: "destructive" })
  }
  const printSheet = () => {
    const categoryOf = new Map(items.map((i) => [i.id, i.categoryId]))
    const nameOf = new Map(categories.map((c) => [c.id, c.name]))
    print(
      <CountSheetPrint
        header={header}
        lines={count.lines.map((l) => ({
          name: l.itemName ?? "",
          sku: l.sku ?? "",
          unit: l.unit ?? "",
          group: nameOf.get(categoryOf.get(l.itemId) ?? "") ?? "Sin categoría",
        }))}
      />,
      `Hoja de conteo #${count.number}`,
    )
  }
  const printRecord = () =>
    print(
      <CountAdjustmentPrint
        header={header}
        countedLines={counted}
        lines={count.lines
          .filter((l) => l.countedQuantity !== null)
          .map((l) => ({
            name: l.itemName ?? "",
            unit: l.unit ?? "",
            expected: l.expectedQuantity,
            counted: l.countedQuantity ?? 0,
            difference: l.difference ?? 0,
            differenceValue: l.differenceValue ?? 0,
            reason: l.notes,
          }))}
      />,
      `Acta de ajuste #${count.number}`,
    )

  const toggle = (lineId: string) =>
    setMarked((prev) => {
      const next = new Set(prev)
      if (!next.delete(lineId)) next.add(lineId)
      return next
    })

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Conteo #${count.number}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {count.locationName}
            <CountStageBadge count={isApplied ? { ...count, stage: "applied" } : count} />
            <span>
              · Cuenta {count.counterName ?? "—"} · Revisa {count.approverName ?? "—"}
            </span>
          </span>
        }
        actions={
          <>
            <Button variant="ghost" onClick={onBack}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Conteos
            </Button>
            {count.stage !== "cancelled" && (
              <Button variant="outline" onClick={printSheet} aria-label="Imprimir hoja de conteo">
                <Printer className="mr-1 h-4 w-4" /> Hoja de conteo
              </Button>
            )}
            {(inReview || isApplied) && (
              <Button variant="outline" onClick={printRecord}>
                <Printer className="mr-1 h-4 w-4" /> Imprimir acta
              </Button>
            )}
            {(count.stage === "draft" || count.stage === "counting") && (
              <Button variant="outline" onClick={() => run(() => cancelCount.mutateAsync(count.id))}>
                Anular
              </Button>
            )}
            {count.stage === "draft" && <Button onClick={() => run(() => startCount.mutateAsync(count.id))}>Iniciar conteo</Button>}
          </>
        }
      />

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {count.stage === "counting" && (
        <div className="space-y-1.5 rounded-lg border p-4">
          <p className="text-sm">
            <b className="tabular-nums">
              {counted} de {count.lines.length}
            </b>{" "}
            contados por {count.counterName}. Se envía a revisión cuando termine.
          </p>
          <Progress value={count.lines.length ? (counted / count.lines.length) * 100 : 0} aria-label="Avance del conteo" />
        </div>
      )}

      {(inReview || isApplied) && (
        <>
          <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg border p-3 text-sm">
            <span>
              <b className="tabular-nums">
                {counted} de {count.lines.length}
              </b>{" "}
              contados
            </span>
            <span>
              <b>{differences.length}</b> con diferencia
            </span>
            <span>
              Faltante <b className={signedClass(missingTotal)}>{formatMoney(missingTotal)}</b>
            </span>
            <span>
              Sobrante <b className={signedClass(surplusTotal)}>{signedMoney(surplusTotal)}</b>
            </span>
            <span>
              Neto <b className={signedClass(missingTotal + surplusTotal)}>{signedMoney(missingTotal + surplusTotal)}</b>
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Ordenado por diferencia en pesos. Las de <b>{formatMoney(threshold)} o más</b> necesitan motivo antes de aplicar.
          </p>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <caption className="sr-only">Diferencias del conteo #{count.number} ordenadas por valor absoluto</caption>
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="p-2">Artículo</th>
                  <th className="p-2 text-right">Sistema</th>
                  <th className="p-2 text-right">Contado</th>
                  <th className="p-2 text-right">Diferencia</th>
                  <th className="p-2 text-right">En pesos</th>
                  <th className="p-2">Motivo</th>
                  {inReview && (
                    <th className="p-2">
                      <span className="sr-only">Acción</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {differences.map((line) => {
                  const big = isBig(line, threshold)
                  const name = line.itemName ?? ""
                  const unit = line.unit ?? ""
                  const recounting = marked.has(line.id)
                  const needs = inReview && big && !line.notes?.trim() && !recounting
                  return (
                    <tr key={line.id} className={cn("border-t align-top", big && "bg-destructive/5")}>
                      <td className="p-2">
                        <b className="font-medium">{name}</b>
                        <span className="block font-mono text-xs text-muted-foreground">{line.sku}</span>
                      </td>
                      <td className="p-2 text-right tabular-nums">{formatQuantity(line.expectedQuantity, unit)}</td>
                      <td className="p-2 text-right tabular-nums">
                        {recounting ? "Recontando" : formatQuantity(line.countedQuantity ?? 0, unit)}
                      </td>
                      <td className={cn("p-2 text-right tabular-nums", signedClass(line.difference ?? 0))}>
                        {signedQuantity(line.difference ?? 0, unit)}
                      </td>
                      <td className={cn("p-2 text-right tabular-nums", signedClass(line.differenceValue ?? 0))}>
                        {signedMoney(line.differenceValue ?? 0)}
                        {big && <span className="block text-xs font-medium">Diferencia grande</span>}
                      </td>
                      <td className="p-2">
                        {inReview ? (
                          <>
                            <NativeSelect
                              aria-label={`Motivo de la diferencia de ${name}${big ? " (obligatorio)" : ""}`}
                              aria-invalid={needs || undefined}
                              value={line.notes ?? ""}
                              disabled={recounting}
                              onChange={(e) =>
                                run(() => setReason.mutateAsync({ countId: count.id, lineId: line.id, reason: e.target.value || null }))
                              }
                            >
                              <option value="">{big ? "Elige el motivo…" : "Motivo (opcional)"}</option>
                              {[...new Set([...COUNT_REASONS, ...(line.notes ? [line.notes] : [])])].map((r) => (
                                <option key={r}>{r}</option>
                              ))}
                            </NativeSelect>
                            {needs && <span className="text-xs text-destructive">Obligatorio por ser ≥ {formatMoney(threshold)}</span>}
                          </>
                        ) : (
                          (line.notes ?? "—")
                        )}
                      </td>
                      {inReview && (
                        <td className="p-2 text-right">
                          <Button
                            size="sm"
                            variant={recounting ? "secondary" : "outline"}
                            aria-pressed={recounting}
                            aria-label={`Recontar ${name}`}
                            onClick={() => toggle(line.id)}
                          >
                            {recounting ? "Quitar recuento" : "Recontar"}
                          </Button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="border-t p-2 text-sm text-muted-foreground">
              {count.lines.length - differences.length} artículos sin diferencia (no se muestran).
            </p>
          </div>
        </>
      )}

      {isApplied && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 p-3 text-sm">
          <span>
            <b>Conteo #{count.number} aplicado.</b> El stock de {count.locationName} quedó igual a lo contado.
          </span>
          {onNavigate && (
            <Button variant="link" onClick={() => onNavigate("inventory/movements")}>
              Ver los movimientos “Ajuste por conteo” →
            </Button>
          )}
        </div>
      )}

      {inReview && (
        <div role="region" aria-label="Aplicar ajuste" className="flex flex-wrap items-center justify-end gap-3 rounded-lg border p-3">
          <p className="mr-auto text-sm" aria-live="polite">
            {missing ? (
              <span className="text-destructive">
                Faltan {missing} {missing === 1 ? "motivo" : "motivos"} para aplicar.
              </span>
            ) : marked.size ? (
              <span>
                <b>{marked.size}</b> por recontar: pide el recuento antes de aplicar.
              </span>
            ) : (
              <span>
                Se crearán <b>{differences.length}</b> movimientos “Ajuste por conteo” por <b>{signedMoney(missingTotal + surplusTotal)}</b>.
                Aprueba {count.approverName}.
              </span>
            )}
          </p>
          <Button
            variant="outline"
            disabled={marked.size === 0 || recount.isPending}
            onClick={() =>
              run(async () => {
                await recount.mutateAsync({ countId: count.id, lineIds: [...marked] })
                setMarked(new Set())
                toast({ title: `${count.counterName ?? "El contador"} verá esas líneas otra vez para recontar` })
              })
            }
          >
            Pedir recuento ({marked.size})
          </Button>
          <Button
            disabled={missing > 0 || marked.size > 0 || applyCount.isPending}
            onClick={() =>
              run(async () => {
                const result = await applyCount.mutateAsync(count.id)
                setApplied(true)
                toast({ title: "Ajuste aplicado", description: `${result.adjustedLines} líneas ajustadas · ${formatMoney(result.valueDelta)}` })
              })
            }
          >
            Aplicar ajuste
          </Button>
        </div>
      )}
    </div>
  )
}
