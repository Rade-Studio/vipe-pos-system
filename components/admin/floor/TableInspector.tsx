"use client"

import { useEffect, useId, useState, type ReactNode } from "react"
import { Trash2, X } from "lucide-react"
import type { Profile, Table, TableShape, TableStatus } from "@/types"
import type { ZoneDto } from "@/lib/api/zones"
import { cn } from "@/lib/utils"
import { MAX_SEATS, MAX_SIZE, MIN_SIZE, SHAPE_LABELS, type LayoutEdit } from "@/lib/floor/editor"
import { TABLE_STATUS } from "@/lib/floor/layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { ShapeIcon } from "./ShapeIcon"

export interface TableData {
  number: number
  status: TableStatus
  waiterId: string | null
}

interface TableInspectorProps {
  table: Table
  zones: ZoneDto[]
  /** False for a table without a zone or coordinates: offer to place it. */
  placed: boolean
  waiters: Profile[]
  onEdit: (edit: LayoutEdit) => void
  onPlace: () => void
  onSaveData: (data: TableData) => Promise<void>
  onDelete: () => Promise<void>
  onClose?: () => void
  className?: string
}

const FIELD = "flex flex-col gap-1.5 text-sm"
const LABEL = "text-xs font-medium text-muted-fg"
const NATIVE_SELECT =
  "h-11 w-full rounded-md border border-line bg-surface px-3 text-sm text-fg focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
const SHAPES: TableShape[] = ["round", "square", "rect", "bar"]

/** Integer input that reports only valid numbers. */
function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  disabled,
  onValue,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  disabled?: boolean
  onValue: (value: number) => void
}) {
  const id = useId()
  return (
    <div className={FIELD}>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        className="h-11 tabular-nums"
        value={Number.isFinite(value) ? value : ""}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => {
          const next = Number.parseFloat(event.target.value)
          if (Number.isFinite(next)) onValue(next)
        }}
      />
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <legend className="float-left mb-1 w-full text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted-fg">{title}</legend>
      {children}
    </fieldset>
  )
}

/**
 * The selected table: layout (forma, tamaño, rotación, sillas, zona) as
 * unsaved changes of the editor, and its data (número, estado, mesero) saved
 * at once with PATCH /tables/:id, as the table list did. Sizes are % of the
 * zone width: a zone stores no real size (S8).
 */
export function TableInspector({
  table,
  zones,
  placed,
  waiters,
  onEdit,
  onPlace,
  onSaveData,
  onDelete,
  onClose,
  className,
}: TableInspectorProps) {
  const headingId = useId()
  const [data, setData] = useState<TableData>({ number: table.number, status: table.status, waiterId: table.waiter ?? null })
  const [savingData, setSavingData] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    setData({ number: table.number, status: table.status, waiterId: table.waiter ?? null })
    setConfirmDelete(false)
  }, [table.id, table.number, table.status, table.waiter])

  const shape = table.shape ?? "square"
  const square = shape === "round" || shape === "square"
  const hasSeats = typeof table.seats === "number" && table.seats > 0
  const percentOf = (fraction: number | undefined) => Math.round((fraction ?? 0.1) * 1000) / 10
  const zoneValue = table.zoneId && zones.some((zone) => zone.id === table.zoneId) ? table.zoneId : ""

  return (
    <section
      aria-labelledby={headingId}
      className={cn("flex min-w-0 flex-col gap-4 rounded-card-lg border border-line bg-surface p-4 text-fg shadow-lg", className)}
    >
      <header className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="text-base font-semibold">
          Mesa {table.number}
        </h2>
        {onClose && (
          <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Cerrar inspector" onClick={onClose}>
            <X className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </header>

      {!placed && (
        <div className="flex flex-col gap-2 rounded-card border border-line bg-surface-2 p-3 text-sm">
          <p className="text-fg-2">Esta mesa no está en el plano.</p>
          <Button className="h-11" onClick={onPlace}>
            Ubicar en el plano
          </Button>
        </div>
      )}

      <Section title="Forma y tamaño">
        <div role="radiogroup" aria-label="Forma" className="grid grid-cols-2 gap-2">
          {SHAPES.map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="radio"
              aria-checked={shape === candidate}
              onClick={() => onEdit({ shape: candidate })}
              className={cn(
                "inline-flex min-h-[44px] items-center gap-2 rounded-card border px-3 text-sm font-medium",
                "focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus",
                shape === candidate ? "border-brand bg-brand-tint text-fg" : "border-line bg-surface-2 text-fg-2",
              )}
            >
              <ShapeIcon shape={candidate} />
              {SHAPE_LABELS[candidate]}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label={square ? "Tamaño (% del ancho)" : "Ancho (% del ancho)"}
            value={percentOf(table.w)}
            min={MIN_SIZE * 100}
            max={MAX_SIZE * 100}
            onValue={(value) => onEdit({ w: value / 100 })}
          />
          {!square && (
            <NumberField
              label="Alto (% del ancho)"
              value={percentOf(table.h)}
              min={MIN_SIZE * 100}
              max={MAX_SIZE * 100}
              onValue={(value) => onEdit({ h: value / 100 })}
            />
          )}
          <NumberField
            label="Rotación (°)"
            value={table.rotation ?? 0}
            min={0}
            max={359}
            step={15}
            onValue={(value) => onEdit({ rotation: value })}
          />
        </div>
      </Section>

      <Section title="Sillas">
        <label className="flex min-h-[44px] items-center justify-between gap-3 text-sm">
          <span>Sillas</span>
          <Switch
            aria-label="Sillas"
            checked={hasSeats}
            onCheckedChange={(checked) => onEdit({ seats: checked ? 4 : undefined })}
          />
        </label>
        <NumberField
          label="Número de sillas"
          value={hasSeats ? (table.seats as number) : 0}
          min={0}
          max={MAX_SEATS}
          disabled={!hasSeats}
          onValue={(value) => onEdit({ seats: value })}
        />
      </Section>

      <Section title="Zona">
        <label className={FIELD}>
          <span className={LABEL}>Zona</span>
          <select
            className={NATIVE_SELECT}
            value={zoneValue}
            onChange={(event) => event.target.value && onEdit({ zoneId: event.target.value })}
          >
            {!zoneValue && <option value="">Sin zona</option>}
            {zones.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.name}
                {zone.active ? "" : " (inactiva)"}
              </option>
            ))}
          </select>
        </label>
      </Section>

      <Section title="Datos de la mesa">
        <NumberField
          label="Número"
          value={data.number}
          min={1}
          max={9999}
          onValue={(value) => setData((prev) => ({ ...prev, number: Math.floor(value) }))}
        />
        <label className={FIELD}>
          <span className={LABEL}>Estado</span>
          <select
            className={NATIVE_SELECT}
            value={data.status}
            onChange={(event) => setData((prev) => ({ ...prev, status: event.target.value as TableStatus }))}
          >
            {(Object.keys(TABLE_STATUS) as TableStatus[]).map((status) => (
              <option key={status} value={status}>
                {TABLE_STATUS[status].label}
              </option>
            ))}
          </select>
        </label>
        <label className={FIELD}>
          <span className={LABEL}>Mesero</span>
          <select
            className={NATIVE_SELECT}
            value={data.waiterId ?? ""}
            onChange={(event) => setData((prev) => ({ ...prev, waiterId: event.target.value || null }))}
          >
            <option value="">Sin mesero</option>
            {table.waiter && !waiters.some((waiter) => waiter.id === table.waiter) && (
              <option value={table.waiter}>{table.waiter_name ?? "Mesero actual"}</option>
            )}
            {waiters.map((waiter) => (
              <option key={waiter.id} value={waiter.id}>
                {waiter.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="outline"
          className="h-11"
          disabled={savingData}
          onClick={async () => {
            setSavingData(true)
            try {
              await onSaveData(data)
            } finally {
              setSavingData(false)
            }
          }}
        >
          Guardar datos
        </Button>
      </Section>

      <div className="border-t border-line pt-3">
        {confirmDelete ? (
          <div className="flex flex-col gap-2 text-sm">
            <p>¿Eliminar la mesa {table.number}? No se puede si tiene órdenes abiertas.</p>
            <div className="flex gap-2">
              <Button variant="outline" className="h-11 flex-1" onClick={() => setConfirmDelete(false)}>
                Cancelar
              </Button>
              <Button variant="destructive" className="h-11 flex-1" onClick={() => void onDelete()}>
                Eliminar
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="ghost"
            className="h-11 w-full justify-start text-destructive hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" aria-hidden />
            Eliminar mesa
          </Button>
        )}
      </div>
    </section>
  )
}
