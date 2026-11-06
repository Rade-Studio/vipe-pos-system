"use client"

import { useEffect, useId, useState } from "react"
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react"
import * as zonesApi from "@/lib/api/zones"
import type { ZoneDto, ZoneLabelDto } from "@/lib/api/zones"
import { ApiError } from "@/lib/api/errors"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"

interface ZoneSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  zones: ZoneDto[]
  /** After any write: refetch the zones. */
  onChanged: () => Promise<void> | void
}

const SIDES: { side: ZoneLabelDto["side"]; label: string }[] = [
  { side: "top", label: "Pared superior" },
  { side: "right", label: "Pared derecha" },
  { side: "bottom", label: "Pared inferior" },
  { side: "left", label: "Pared izquierda" },
]

const ICON_BUTTON = "h-11 w-11 shrink-0"

const metres = (text: string): number | null => {
  const value = Number.parseFloat(text.replace(",", "."))
  return text.trim() === "" || !Number.isFinite(value) ? null : value
}

/** The typed measures; `aspect` (width / depth, 2 decimals) only when both are positive. */
function zoneDimensions(widthText: string, depthText: string): { widthM: number | null; depthM: number | null; aspect?: string; touched: boolean } {
  const widthM = metres(widthText)
  const depthM = metres(depthText)
  const both = widthM !== null && depthM !== null && widthM > 0 && depthM > 0
  return {
    widthM,
    depthM,
    aspect: both ? String(Math.round((widthM / depthM) * 100) / 100) : undefined,
    touched: widthText.trim() !== "" || depthText.trim() !== "",
  }
}

/** The API's words for a refused write (409 duplicate name / zone with tables, 422 invalid value). */
const errorText = (error: unknown, fallback: string): string =>
  error instanceof ApiError && (error.status === 409 || error.status === 422 || error.status === 400) ? error.message : fallback

function ZoneRow({
  zone,
  index,
  count,
  run,
  onMove,
}: {
  zone: ZoneDto
  index: number
  count: number
  run: (action: () => Promise<unknown>, fallback: string) => Promise<void>
  onMove: (index: number, delta: -1 | 1) => Promise<void>
}) {
  const id = useId()
  const [name, setName] = useState(zone.name)
  const [aspect, setAspect] = useState(String(zone.aspect))
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [active, setActive] = useState(zone.active)
  const [widthM, setWidthM] = useState(zone.widthM == null ? "" : String(zone.widthM))
  const [depthM, setDepthM] = useState(zone.depthM == null ? "" : String(zone.depthM))
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    setName(zone.name)
    setAspect(String(zone.aspect))
    setActive(zone.active)
    setWidthM(zone.widthM == null ? "" : String(zone.widthM))
    setDepthM(zone.depthM == null ? "" : String(zone.depthM))
    setLabels(Object.fromEntries(zone.labels.map((label) => [label.side, label.text])))
  }, [zone])

  const dimensions = zoneDimensions(widthM, depthM)
  // With both measures the proportion follows them (the floor is drawn at it).
  const shownAspect = dimensions.aspect ?? aspect
  const hadDimensions = zone.widthM != null || zone.depthM != null

  const save = () =>
    run(
      () =>
        zonesApi.update(zone.id, {
          name: name.trim(),
          aspect: Number.parseFloat(shownAspect),
          labels: SIDES.flatMap(({ side }) => (labels[side]?.trim() ? [{ text: labels[side].trim(), side }] : [])),
          active,
          // Sent together (the API refuses one alone with its own message); untouched zones keep the T5 body.
          ...(dimensions.touched || hadDimensions ? { widthM: dimensions.widthM, depthM: dimensions.depthM } : {}),
        }),
      "No se pudo guardar la zona.",
    )

  return (
    <li className="flex flex-col gap-3 rounded-card border border-line bg-surface p-3">
      <div className="flex items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor={`${id}-name`} className="text-xs font-medium text-muted-fg">
            Nombre
          </label>
          <Input
            id={`${id}-name`}
            aria-label={`Nombre de ${zone.name}`}
            className="h-11"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          className={ICON_BUTTON}
          aria-label={`Subir ${zone.name}`}
          disabled={index === 0}
          onClick={() => void onMove(index, -1)}
        >
          <ArrowUp className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className={ICON_BUTTON}
          aria-label={`Bajar ${zone.name}`}
          disabled={index === count - 1}
          onClick={() => void onMove(index, 1)}
        >
          <ArrowDown className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-aspect`} className="text-xs font-medium text-muted-fg">
            Proporción (ancho / alto)
          </label>
          <Input
            id={`${id}-aspect`}
            type="number"
            step={0.1}
            min={0.3}
            max={3.9}
            className="h-11 tabular-nums"
            value={shownAspect}
            disabled={dimensions.aspect !== undefined}
            onChange={(event) => setAspect(event.target.value)}
          />
        </div>
        <label className="flex min-h-[44px] items-center justify-between gap-2 self-end text-sm">
          <span>Activa</span>
          <Switch aria-label={`Activa ${zone.name}`} checked={active} onCheckedChange={setActive} />
        </label>
      </div>

      <fieldset role="group" aria-label="Ancho × fondo (m)" className="flex min-w-0 flex-col gap-1.5">
        <legend className="mb-1.5 text-xs font-medium text-muted-fg">Ancho × fondo (m)</legend>
        <div className="flex items-center gap-2">
          <Input
            aria-label="Ancho (m)"
            type="number"
            inputMode="decimal"
            step={0.1}
            min={0.1}
            max={200}
            placeholder="Ancho"
            className="h-11 min-w-0 flex-1 tabular-nums"
            value={widthM}
            onChange={(event) => setWidthM(event.target.value)}
          />
          <span aria-hidden className="text-muted-fg">
            ×
          </span>
          <Input
            aria-label="Fondo (m)"
            type="number"
            inputMode="decimal"
            step={0.1}
            min={0.1}
            max={200}
            placeholder="Fondo"
            className="h-11 min-w-0 flex-1 tabular-nums"
            value={depthM}
            onChange={(event) => setDepthM(event.target.value)}
          />
        </div>
        <p className="text-xs text-muted-fg">Con las medidas reales el plano muestra centímetros y la proporción se calcula sola.</p>
      </fieldset>

      <details className="text-sm">
        <summary className="flex min-h-[44px] cursor-pointer items-center text-fg-2">Rótulos de las paredes</summary>
        <div className="grid grid-cols-1 gap-2 pt-2 sm:grid-cols-2">
          {SIDES.map(({ side, label }) => (
            <div key={side} className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-${side}`} className="text-xs font-medium text-muted-fg">
                {label}
              </label>
              <Input
                id={`${id}-${side}`}
                className="h-11"
                placeholder="Ej.: Entrada"
                value={labels[side] ?? ""}
                onChange={(event) => setLabels((prev) => ({ ...prev, [side]: event.target.value }))}
              />
            </div>
          ))}
        </div>
      </details>

      {confirmDelete ? (
        <div className="flex flex-col gap-2 rounded-card border border-status-danger-line bg-status-danger-bg p-3 text-sm text-status-danger-fg">
          <p>¿Eliminar {zone.name}? Solo se puede si no tiene mesas.</p>
          <div className="flex gap-2">
            <Button variant="outline" className="h-11 flex-1" onClick={() => setConfirmDelete(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              className="h-11 flex-1"
              aria-label={`Confirmar eliminar ${zone.name}`}
              onClick={async () => {
                setConfirmDelete(false)
                await run(() => zonesApi.delete(zone.id), "No se pudo eliminar la zona.")
              }}
            >
              Eliminar
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            variant="ghost"
            className="h-11 text-destructive hover:text-destructive"
            aria-label={`Eliminar ${zone.name}`}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" aria-hidden />
            Eliminar
          </Button>
          <Button className="ml-auto h-11" aria-label={`Guardar ${zone.name}`} onClick={() => void save()}>
            Guardar
          </Button>
        </div>
      )}
    </li>
  )
}

/** "Gestionar zonas": create, rename, reorder (sortOrder), aspect, wall labels, active, delete. */
export function ZoneSheet({ open, onOpenChange, zones, onChanged }: ZoneSheetProps) {
  const newId = useId()
  const [newName, setNewName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      await onChanged()
    } catch (caught) {
      setError(errorText(caught, fallback))
    } finally {
      setBusy(false)
    }
  }

  const move = async (index: number, delta: -1 | 1) => {
    const zone = zones[index]
    const other = zones[index + delta]
    if (!zone || !other) return
    await run(async () => {
      await zonesApi.update(other.id, { sortOrder: index })
      await zonesApi.update(zone.id, { sortOrder: index + delta })
    }, "No se pudo cambiar el orden.")
  }

  const create = async () => {
    const name = newName.trim()
    if (!name) return
    const sortOrder = zones.reduce((max, zone) => Math.max(max, zone.sortOrder), -1) + 1
    await run(async () => {
      await zonesApi.create({ name, sortOrder })
      setNewName("")
    }, "No se pudo crear la zona.")
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-4 overflow-y-auto bg-canvas sm:max-w-md" aria-busy={busy}>
        <SheetHeader>
          <SheetTitle>Gestionar zonas</SheetTitle>
          <SheetDescription>El orden de la lista es el de las pestañas del plano.</SheetDescription>
        </SheetHeader>

        {error && (
          <p role="alert" className="rounded-card border border-status-danger-line bg-status-danger-bg px-3 py-2 text-sm text-status-danger-fg">
            {error}
          </p>
        )}

        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void create()
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <label htmlFor={newId} className="text-xs font-medium text-muted-fg">
              Nueva zona
            </label>
            <Input id={newId} className="h-11" placeholder="Ej.: Terraza" value={newName} onChange={(event) => setNewName(event.target.value)} />
          </div>
          <Button type="submit" className="h-11" disabled={!newName.trim() || busy}>
            Crear zona
          </Button>
        </form>

        {zones.length === 0 ? (
          <p className="text-sm text-muted-fg">Todavía no hay zonas.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {zones.map((zone, index) => (
              <ZoneRow key={zone.id} zone={zone} index={index} count={zones.length} run={run} onMove={move} />
            ))}
          </ol>
        )}
      </SheetContent>
    </Sheet>
  )
}
