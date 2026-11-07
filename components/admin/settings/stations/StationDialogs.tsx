import { useEffect, useState } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { StationColor, StationDto } from "@/lib/api/stations"
import { joinNames } from "@/lib/admin/stations"
import { cn } from "@/lib/utils"
import { platos, STATION_COLORS, STATION_STYLE } from "./station-style"

const errorText = (error: unknown) => (error instanceof Error ? error.message : "Inténtalo de nuevo")

const radio = (checked: boolean) =>
  cn(
    "flex min-h-[52px] w-full items-center gap-3 rounded-xl border px-3.5 py-2 text-left focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-focus",
    checked ? "border-brand bg-brand-tint ring-1 ring-brand" : "border-line-strong bg-card hover:bg-surface-2",
  )
const dot = (checked: boolean) => cn("h-[18px] w-[18px] flex-none rounded-full border-2", checked ? "border-[5px] border-brand" : "border-line-strong")

interface StationFormDialogProps {
  /** null: closed; "new": create; a station: edit it. */
  target: StationDto | "new" | null
  onClose: () => void
  onSave: (input: { name: string; color: StationColor }) => Promise<unknown>
}

/** Create or rename / recolour a prep station. The API's Spanish refusal shows in the dialog. */
export function StationFormDialog({ target, onClose, onSave }: StationFormDialogProps) {
  const editing = target !== null && target !== "new" ? target : null
  const [name, setName] = useState("")
  const [color, setColor] = useState<StationColor>("kitchen")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setName(editing?.name ?? "")
    setColor(editing?.color ?? "kitchen")
    setError(null)
  }, [target])

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave({ name: name.trim(), color })
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? `Editar ${editing.name}` : "Nueva estación"}</DialogTitle>
          <DialogDescription>Donde se prepara una parte del menú: cocina caliente, barra, postres…</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <label className="grid gap-1.5 text-sm font-medium">
            Nombre
            <input
              value={name}
              maxLength={40}
              onChange={(event) => setName(event.target.value)}
              className="min-h-11 rounded-full border border-line-strong bg-card px-4 text-base font-normal focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-focus"
            />
          </label>
          <div role="radiogroup" aria-label="Color" className="flex flex-wrap gap-2">
            {STATION_COLORS.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={color === value}
                onClick={() => setColor(value)}
                className={cn(
                  "inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 text-sm font-semibold",
                  STATION_STYLE[value].chip,
                  color === value && "ring-2 ring-brand ring-offset-2 ring-offset-background",
                )}
              >
                {STATION_STYLE[value].label}
              </button>
            ))}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="min-h-11 rounded-full" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" className="min-h-11 rounded-full" disabled={saving || name.trim().length === 0}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface DeleteStationDialogProps {
  station: StationDto | null
  /** Prep stations the routes can move to (the station itself excluded). */
  targets: StationDto[]
  categories: string[]
  dishCount: number
  onClose: () => void
  onDelete: (station: StationDto, moveTo: string | null) => Promise<unknown>
}

/** "¿Eliminar la estación X?": its routes move to the chosen station in the same transaction. */
export function DeleteStationDialog({ station, targets, categories, dishCount, onClose, onDelete }: DeleteStationDialogProps) {
  const [moveTo, setMoveTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setMoveTo((targets.find((target) => target.isDefault) ?? targets[0])?.id ?? null)
    setError(null)
  }, [station])
  const chosen = targets.find((target) => target.id === moveTo) ?? null

  const confirm = async () => {
    if (!station) return
    setSaving(true)
    setError(null)
    try {
      await onDelete(station, chosen?.id ?? null)
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={station !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <span className="inline-flex h-[26px] w-fit items-center gap-1.5 rounded-full border border-status-danger-line bg-status-danger-bg px-2.5 text-[12.5px] font-semibold text-status-danger-fg">
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Eliminar
          </span>
          <DialogTitle>¿Eliminar la estación {station?.name}?</DialogTitle>
          <DialogDescription className="text-fg-2">
            {categories.length > 0 ? (
              <>
                {station?.name} recibe <b>{joinNames(categories)}</b> ({platos(dishCount)}).{" "}
              </>
            ) : null}
            {targets.length > 0
              ? "Elige a qué estación pasan sus categorías, excepciones y comandas abiertas para que ninguna quede sin destino."
              : "Es la única estación de preparación: sus categorías quedarán sin estación."}
          </DialogDescription>
        </DialogHeader>
        {targets.length > 0 && (
          <div role="radiogroup" aria-label="Mover a" className="grid gap-2">
            {targets.map((target) => (
              <button key={target.id} type="button" role="radio" aria-checked={moveTo === target.id} onClick={() => setMoveTo(target.id)} className={radio(moveTo === target.id)}>
                <span aria-hidden className={dot(moveTo === target.id)} />
                <span className="min-w-0 flex-1">
                  <b className="font-semibold">{target.name}</b>
                  <small className="block text-[12.5px] text-muted-fg">Sin impresora: solo pantalla de cocina</small>
                </span>
              </button>
            ))}
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" className="min-h-11 rounded-full" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" variant="destructive" className="min-h-11 rounded-full" disabled={saving} onClick={() => void confirm()}>
            {chosen ? `Mover a ${chosen.name} y eliminar` : "Eliminar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
