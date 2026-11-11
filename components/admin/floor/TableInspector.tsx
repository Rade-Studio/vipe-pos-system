"use client"

import { useEffect, useId, useRef, useState, type ReactNode, type SelectHTMLAttributes } from "react"
import { ChevronDown, Trash2, X } from "lucide-react"
import type { Profile, Table, TableShape, TableStatus } from "@/types"
import type { ZoneDto } from "@/lib/api/zones"
import { cn } from "@/lib/utils"
import { MAX_SEATS, MAX_SIZE, MIN_SIZE, SHAPE_LABELS, type LayoutEdit } from "@/lib/floor/editor"
import { manualStatusOptions } from "@/lib/floor/layout"
import { fromCm, hasDimensions, sizeText, toCm, yFromCm, yToCm, type ZoneUnits } from "@/lib/admin/floor/units"
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
  /** Switch "Activa" at once with PATCH /tables/:id (not part of the unsaved layout). */
  onSetActive: (isActive: boolean) => Promise<void>
  onPlace: () => void
  /** Resolves false when the save failed: the inspector goes back to the saved data. */
  onSaveData: (data: TableData) => Promise<boolean>
  onDelete: () => Promise<void>
  onClose?: () => void
  className?: string
}

const FIELD = "flex flex-col gap-1.5 text-sm"
const LABEL = "text-xs font-medium text-muted-fg"
const NATIVE_SELECT =
  "h-11 w-full appearance-none rounded-md border border-line bg-surface pl-3 pr-10 text-sm text-fg focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
const SHAPES: TableShape[] = ["round", "square", "rect", "bar"]

/** Native select with its own chevron, clear of the right edge. */
function NativeSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...props} className={NATIVE_SELECT} />
      <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-fg" />
    </div>
  )
}

/**
 * Number input that reports only valid numbers. While typing it may be empty
 * or partial; on blur it shows the current value again.
 */
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
  const shown = Number.isFinite(value) ? String(value) : ""
  const [text, setText] = useState<string | null>(null)
  // A value changed from outside (undo, a failed save, clamping) replaces what was typed.
  useEffect(() => {
    setText((typed) => (typed !== null && Number.parseFloat(typed) === value ? typed : null))
  }, [value])
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
        value={text ?? shown}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => {
          setText(event.target.value)
          const next = Number.parseFloat(event.target.value)
          if (Number.isFinite(next)) onValue(next)
        }}
        onBlur={() => setText(null)}
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
 * at once with PATCH /tables/:id, as the table list did. Sizes and positions
 * are in cm on a zone with `widthM × depthM` (T26), otherwise % of the zone
 * width with a hint to set the zone's measures.
 */
export function TableInspector({
  table,
  zones,
  placed,
  waiters,
  onEdit,
  onSetActive,
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
  const [deleting, setDeleting] = useState(false)
  // Clicks that land before the disabled state renders must not delete twice.
  const deletingRef = useRef(false)
  const [savingActive, setSavingActive] = useState(false)

  useEffect(() => {
    setData({ number: table.number, status: table.status, waiterId: table.waiter ?? null })
    setConfirmDelete(false)
  }, [table.id, table.number, table.status, table.waiter])

  const shape = table.shape ?? "square"
  const square = shape === "round" || shape === "square"
  const hasSeats = typeof table.seats === "number" && table.seats > 0
  const percentOf = (fraction: number | undefined) => Math.round((fraction ?? 0.1) * 1000) / 10
  const zoneValue = table.zoneId && zones.some((zone) => zone.id === table.zoneId) ? table.zoneId : ""
  const units: ZoneUnits | undefined = zones.find((zone) => zone.id === table.zoneId)
  const real = !!units && hasDimensions(units)
  const active = table.isActive !== false

  return (
    <section
      aria-labelledby={headingId}
      // Focus never lands under the sticky save bar: each control keeps the bar's height (plus its offset) clear below it.
      className={cn(
        "flex min-w-0 flex-col gap-4 rounded-card-lg border border-line bg-surface p-4 text-fg shadow-lg [&_:is(button,input,select,summary)]:scroll-mb-40",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 id={headingId} className="text-base font-semibold">
            Mesa {table.number}
          </h2>
          {units && <p className="text-xs tabular-nums text-muted-fg">{sizeText(table, units)}</p>}
        </div>
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
          {real && units ? (
            <>
              <NumberField
                label={square ? "Tamaño (cm)" : "Ancho (cm)"}
                value={toCm(table.w ?? 0.1, units)}
                min={Math.ceil(toCm(MIN_SIZE, units))}
                max={Math.floor(toCm(MAX_SIZE, units))}
                step={10}
                onValue={(value) => onEdit({ w: fromCm(value, units) })}
              />
              {!square && (
                <NumberField
                  label="Alto (cm)"
                  value={toCm(table.h ?? table.w ?? 0.1, units)}
                  min={Math.ceil(toCm(MIN_SIZE, units))}
                  max={Math.floor(toCm(MAX_SIZE, units))}
                  step={10}
                  onValue={(value) => onEdit({ h: fromCm(value, units) })}
                />
              )}
              {placed && (
                <>
                  <NumberField
                    label="Posición X (cm)"
                    value={toCm(table.x ?? 0.5, units)}
                    min={0}
                    max={toCm(1, units)}
                    step={10}
                    onValue={(value) => onEdit({ x: fromCm(value, units) })}
                  />
                  <NumberField
                    label="Posición Y (cm)"
                    value={yToCm(table.y ?? 0.5, units)}
                    min={0}
                    max={yToCm(1, units)}
                    step={10}
                    onValue={(value) => onEdit({ y: yFromCm(value, units) })}
                  />
                </>
              )}
            </>
          ) : (
            <>
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
            </>
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
        {units && !real && (
          <p className="text-xs text-muted-fg">
            Medidas en % del ancho de la zona. Indica el ancho y el fondo de la zona en Gestionar zonas para verlas en centímetros.
          </p>
        )}
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
          <NativeSelect
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
          </NativeSelect>
        </label>
      </Section>

      <Section title="Disponibilidad">
        <label className="flex min-h-[44px] items-center justify-between gap-3 text-sm">
          <span>{active ? "Activa" : "Inactiva"}</span>
          <Switch
            aria-label="Activa"
            checked={active}
            disabled={savingActive}
            onCheckedChange={async (checked) => {
              setSavingActive(true)
              try {
                await onSetActive(checked)
              } finally {
                setSavingActive(false)
              }
            }}
          />
        </label>
        <p className="text-xs text-muted-fg">
          {active ? "Recibe órdenes y se ve en el mapa del mesero." : "No recibe órdenes nuevas; se ve atenuada en el mapa y conserva su historial."}
        </p>
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
          <NativeSelect
            value={data.status}
            onChange={(event) => setData((prev) => ({ ...prev, status: event.target.value as TableStatus }))}
          >
            {manualStatusOptions(table.status).map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className={FIELD}>
          <span className={LABEL}>Mesero</span>
          <NativeSelect
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
          </NativeSelect>
        </label>
        <Button
          variant="outline"
          className="h-11"
          disabled={savingData}
          onClick={async () => {
            setSavingData(true)
            try {
              if (!(await onSaveData(data))) {
                setData({ number: table.number, status: table.status, waiterId: table.waiter ?? null })
              }
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
              <Button
                variant="destructive"
                className="h-11 flex-1"
                disabled={deleting}
                onClick={async () => {
                  if (deletingRef.current) return
                  deletingRef.current = true
                  setDeleting(true)
                  try {
                    await onDelete()
                  } finally {
                    deletingRef.current = false
                    setDeleting(false)
                    // A refused delete closes the confirm: one message per attempt.
                    setConfirmDelete(false)
                  }
                }}
              >
                {deleting ? "Eliminando…" : "Eliminar"}
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
