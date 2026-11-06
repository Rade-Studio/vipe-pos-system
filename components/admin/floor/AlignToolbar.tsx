"use client"

import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  X,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { AlignMode, DistributeAxis } from "@/lib/admin/floor/align"

const ALIGN: { mode: AlignMode; label: string; icon: LucideIcon }[] = [
  { mode: "left", label: "Alinear a la izquierda", icon: AlignStartVertical },
  { mode: "hcenter", label: "Centrar en horizontal", icon: AlignCenterVertical },
  { mode: "right", label: "Alinear a la derecha", icon: AlignEndVertical },
  { mode: "top", label: "Alinear arriba", icon: AlignStartHorizontal },
  { mode: "vmiddle", label: "Centrar en vertical", icon: AlignCenterHorizontal },
  { mode: "bottom", label: "Alinear abajo", icon: AlignEndHorizontal },
]
const DISTRIBUTE: { axis: DistributeAxis; label: string; icon: LucideIcon }[] = [
  { axis: "h", label: "Distribuir en horizontal", icon: AlignHorizontalDistributeCenter },
  { axis: "v", label: "Distribuir en vertical", icon: AlignVerticalDistributeCenter },
]

const ICON_BUTTON =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] text-fg-2 hover:bg-surface-2 hover:text-fg disabled:opacity-40 focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"

/** Multi-selection bar (design/admin-floor-plan/01 `.multibar`): count, align, distribute, clear. */
export function AlignToolbar({
  count,
  onAlign,
  onDistribute,
  onClear,
}: {
  count: number
  onAlign: (mode: AlignMode) => void
  onDistribute: (axis: DistributeAxis) => void
  onClear: () => void
}) {
  return (
    <div
      role="toolbar"
      aria-label="Acciones de selección múltiple"
      className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-[20px] border border-brand-line bg-surface p-1.5 shadow-lg"
    >
      <span className="px-2 text-sm font-medium">
        <span className="tabular-nums">{count}</span> seleccionadas
      </span>
      <span aria-hidden className="mx-0.5 w-px self-stretch bg-line" />
      <div role="group" aria-label="Alinear" className="flex flex-wrap">
        {ALIGN.map(({ mode, label, icon: Icon }) => (
          <button key={mode} type="button" aria-label={label} title={label} className={ICON_BUTTON} onClick={() => onAlign(mode)}>
            <Icon className="h-[18px] w-[18px]" aria-hidden />
          </button>
        ))}
      </div>
      <span aria-hidden className="mx-0.5 w-px self-stretch bg-line" />
      <div role="group" aria-label="Distribuir" className="flex">
        {DISTRIBUTE.map(({ axis, label, icon: Icon }) => (
          <button
            key={axis}
            type="button"
            aria-label={label}
            title={count < 3 ? "Distribuir necesita 3 mesas o más" : label}
            disabled={count < 3}
            className={ICON_BUTTON}
            onClick={() => onDistribute(axis)}
          >
            <Icon className="h-[18px] w-[18px]" aria-hidden />
          </button>
        ))}
      </div>
      {count < 3 && <span className="px-1 text-xs text-muted-fg">Distribuir necesita 3 mesas o más.</span>}
      <button type="button" aria-label="Quitar selección" className={cn(ICON_BUTTON, "ml-auto")} onClick={onClear}>
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  )
}
