"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

const QUICK_UNITS = ["g", "ml", "unidad", "kg", "l"] as const

interface CreatePreparationDialogProps {
  /** Name typed in the search; null closes the dialog. */
  initialName: string | null
  creating: boolean
  onCancel: () => void
  onCreate: (input: { name: string; unit: string }) => void
}

/** Name + one-click unit, then the new preparation opens nested. */
export function CreatePreparationDialog({ initialName, creating, onCancel, onCreate }: CreatePreparationDialogProps) {
  const [name, setName] = useState("")
  const [unit, setUnit] = useState<string>("g")

  useEffect(() => {
    if (initialName !== null) {
      setName(initialName)
      setUnit("g")
    }
  }, [initialName])

  const submit = () => {
    if (name.trim() && !creating) onCreate({ name: name.trim(), unit })
  }

  return (
    <Dialog open={initialName !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva preparación</DialogTitle>
          <DialogDescription>
            Se crea con stock propio y se abre encima de la fórmula actual para que definas sus ingredientes.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="new-prep-name">Nombre</Label>
            <Input id="new-prep-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium" id="new-prep-unit">
              Unidad
            </p>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby="new-prep-unit">
              {QUICK_UNITS.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={unit === option}
                  onClick={() => setUnit(option)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm transition-colors hover:bg-accent",
                    unit === option && "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={onCancel} disabled={creating}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!name.trim() || creating}>
              {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Crear y abrir
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
