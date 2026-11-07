"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, Unlink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type { DesktopDeviceDto } from "@/lib/api/desktop"

const BTN = "min-h-11 rounded-full"

interface RenameProps {
  device: DesktopDeviceDto | null
  busy: boolean
  onClose: () => void
  onSave: (name: string) => void
}

/** Name 1..60 characters (desktop_devices CHECK, L34). */
export function RenameDeviceDialog({ device, busy, onClose, onSave }: RenameProps) {
  const [name, setName] = useState("")
  useEffect(() => setName(device?.name ?? ""), [device])
  const trimmed = name.trim()
  return (
    <Dialog open={device !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (trimmed) onSave(trimmed)
          }}
        >
          <DialogHeader>
            <DialogTitle>Cambiar nombre</DialogTitle>
            <DialogDescription>Un nombre para reconocer el computador, por ejemplo «Caja principal».</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="device-name">Nombre</Label>
            <Input id="device-name" className="min-h-11" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </div>
          <DialogFooter className="gap-2.5">
            <Button type="button" variant="outline" className={BTN} onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" className={BTN} disabled={!trimmed || trimmed === device?.name || busy}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface RevokeProps {
  device: DesktopDeviceDto | null
  busy: boolean
  onClose: () => void
  onRevoke: () => void
}

export function RevokeDeviceDialog({ device, busy, onClose, onRevoke }: RevokeProps) {
  const pending = device?.queue.pending ?? 0
  const failed = device?.queue.failed ?? 0
  return (
    <AlertDialog open={device !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="sm:max-w-[460px]">
        <AlertDialogHeader>
          <AlertDialogTitle>¿Desvincular {device?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            El computador deja de imprimir de inmediato y debe conectarse de nuevo con un código nuevo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {(pending > 0 || failed > 0) && (
          <p className="flex items-start gap-2.5 rounded-xl border border-status-danger-line bg-status-danger-bg px-3.5 py-3 text-[13.5px] text-status-danger-fg">
            <AlertTriangle className="mt-px h-[18px] w-[18px] flex-none" aria-hidden />
            <span className="min-w-0 flex-1">
              Tiene <b>{pending} {pending === 1 ? "trabajo" : "trabajos"} en cola</b> y <b>{failed} {failed === 1 ? "fallido" : "fallidos"}</b>. No se
              imprimirán: reimprímelos desde Órdenes si los necesitas.
            </span>
          </p>
        )}
        <AlertDialogFooter className="gap-2.5">
          <AlertDialogCancel className={BTN}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className={`${BTN} border border-status-danger-line bg-status-danger-bg text-status-danger-fg hover:bg-status-danger-bg/80`}
            disabled={busy}
            onClick={onRevoke}
          >
            <Unlink className="mr-2 h-4 w-4" aria-hidden />
            Desvincular
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
