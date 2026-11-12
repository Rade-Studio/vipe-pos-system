import { Badge } from "@/components/ui/badge"
import type { CountStage, CountStatus, InventoryCount } from "@/lib/api/inventory/types"

export const STAGE_LABEL: Record<CountStage, string> = {
  draft: "Borrador",
  counting: "En conteo",
  review: "En revisión",
  applied: "Aplicado",
  cancelled: "Anulado",
}
const STAGE_VARIANT = { draft: "outline", counting: "secondary", review: "warning", applied: "default", cancelled: "outline" } as const

const STATUS_LABEL: Record<CountStatus, string> = { open: "Abierto", applied: "Aplicado", cancelled: "Cancelado" }
const STATUS_VARIANT = { open: "warning", applied: "default", cancelled: "outline" } as const

/** Stage when the API sends it; the legacy status otherwise. */
export function CountStageBadge({ count }: { count: Pick<InventoryCount, "status"> & { stage?: CountStage } }) {
  return count.stage ? (
    <Badge variant={STAGE_VARIANT[count.stage]}>{STAGE_LABEL[count.stage]}</Badge>
  ) : (
    <Badge variant={STATUS_VARIANT[count.status]}>{STATUS_LABEL[count.status]}</Badge>
  )
}

/** A count with a counter goes through the S5 flow; one without stays on the legacy sheet. */
export const isAssigned = (count: { counterId?: string | null }) => !!count.counterId

const STEPS = [
  ["Preparar", "Elige bodega, qué se cuenta, quién cuenta y quién revisa."],
  ["Contar", "En el celular o en la hoja impresa, sin ver el stock del sistema."],
  ["Revisar diferencias", "Las más costosas primero; recontar o explicar el motivo."],
  ["Aplicar ajuste", "El stock queda igual a lo contado y se registra en Movimientos."],
] as const

export function CountSteps() {
  return (
    <ol aria-label="Cómo funciona un conteo" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {STEPS.map(([title, text], index) => (
        <li key={title} className="flex gap-3 rounded-lg border p-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold tabular-nums">
            {index + 1}
          </span>
          <span className="text-sm">
            <b className="block">{title}</b>
            <span className="text-muted-foreground">{text}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

export const errorMessage = (error: unknown) => (error as { message?: string })?.message ?? "Ocurrió un error."
