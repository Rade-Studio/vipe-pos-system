"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Copy, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { createPrinter, listPrinters, printerErrorMessage, revokePrinter, type PrinterDevice } from "@/lib/api/devices"
import { SettingsPage } from "./SettingsPage"

export const printersKey = ["admin", "devices", "printers"] as const

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : "Nunca"

/**
 * Printer tokens of the printing bridge (T8c). Each station runs
 * `pos/app.py` with its token (`VIPE_PRINTER_TOKEN`); the API keeps only its
 * hash, so the plaintext is shown once, right after creation.
 */
export function PrintersPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [name, setName] = useState("")
  const [token, setToken] = useState<string | null>(null)
  const [toRevoke, setToRevoke] = useState<PrinterDevice | null>(null)

  const { data: printers = [], isLoading, isError, error } = useQuery({ queryKey: printersKey, queryFn: listPrinters })

  const create = useMutation({
    mutationFn: (printerName: string) => createPrinter(printerName),
    onSuccess: (created) => {
      setToken(created.token)
      setName("")
      queryClient.invalidateQueries({ queryKey: printersKey })
    },
    onError: (err) => toast({ title: "Error", description: printerErrorMessage(err), variant: "destructive" }),
  })

  const revoke = useMutation({
    mutationFn: (id: string) => revokePrinter(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: printersKey })
      toast({ title: "Impresora revocada", description: "La estación ya no puede recibir trabajos." })
    },
    onError: (err) => toast({ title: "Error", description: printerErrorMessage(err), variant: "destructive" }),
    onSettled: () => setToRevoke(null),
  })

  const closeCreate = (open: boolean) => {
    setIsCreateOpen(open)
    if (!open) {
      // Drop the mutation result too, so the plaintext token cannot come back.
      create.reset()
      setToken(null)
      setName("")
    }
  }

  const copyToken = async () => {
    if (!token) return
    try {
      await navigator.clipboard.writeText(token)
      toast({ title: "Token copiado" })
    } catch {
      toast({ title: "Error", description: "No se pudo copiar el token", variant: "destructive" })
    }
  }

  return (
    <SettingsPage
      title="Impresoras"
      description="Estaciones de impresión de facturas y comandas."
      actions={
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nueva impresora
        </Button>
      }
    >
      <section className="rounded-lg border bg-card p-4 text-card-foreground sm:px-6">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : isError ? (
          <p className="py-6 text-center text-sm text-destructive">
            No se pudieron cargar las impresoras: {printerErrorMessage(error)}
          </p>
        ) : printers.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No hay impresoras registradas</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead className="hidden md:table-cell">Creada</TableHead>
                <TableHead>Última conexión</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {printers.map((printer) => (
                <TableRow key={printer.id}>
                  <TableCell className="font-medium">{printer.name}</TableCell>
                  <TableCell className="hidden md:table-cell">{formatDate(printer.createdAt)}</TableCell>
                  <TableCell>{formatDate(printer.lastSeenAt)}</TableCell>
                  <TableCell>
                    <Badge variant={printer.revokedAt ? "secondary" : "default"}>
                      {printer.revokedAt ? "Revocada" : "Activa"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {!printer.revokedAt && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Revocar ${printer.name}`}
                        onClick={() => setToRevoke(printer)}
                      >
                        Revocar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <Dialog open={isCreateOpen} onOpenChange={closeCreate}>
        <DialogContent className="sm:max-w-[480px]">
          {token ? (
            <>
              <DialogHeader>
                <DialogTitle>Token de la impresora</DialogTitle>
                <DialogDescription>
                  Copia este token ahora y configúralo en la estación (VIPE_PRINTER_TOKEN): no se volverá a mostrar.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded-md bg-muted px-3 py-2 font-mono text-sm">{token}</code>
                <Button type="button" variant="outline" size="icon" aria-label="Copiar token" onClick={copyToken}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={() => closeCreate(false)}>Listo</Button>
              </DialogFooter>
            </>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                if (name.trim()) create.mutate(name.trim())
              }}
            >
              <DialogHeader>
                <DialogTitle>Nueva impresora</DialogTitle>
                <DialogDescription>Un nombre para reconocer la estación, por ejemplo «Cocina».</DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="printer-name">Nombre</Label>
                <Input
                  id="printer-name"
                  value={name}
                  maxLength={100}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => closeCreate(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={!name.trim() || create.isPending}>
                  Crear
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={toRevoke !== null} onOpenChange={(open) => !open && setToRevoke(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Revocar {toRevoke?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              La estación se desconecta y deja de recibir facturas y comandas. Para volver a usarla hay que crear un
              token nuevo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => toRevoke && revoke.mutate(toRevoke.id)}>Revocar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPage>
  )
}
