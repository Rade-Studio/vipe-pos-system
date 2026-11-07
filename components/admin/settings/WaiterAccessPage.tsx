"use client"

import { useState, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, KeyRound, ShieldCheck, Smartphone, Tablet } from "lucide-react"
import { Button } from "@/components/ui/button"
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
import { ChangeOwnPinDialog } from "@/components/auth/ChangeOwnPinDialog"
import { PinField, PinFormError } from "@/components/auth/PinField"
import { useToast } from "@/hooks/use-toast"
import { catalogKeys } from "@/lib/admin/catalog"
import { CONFIG_QUERY_KEY, fetchConfig, saveConfig, type BusinessConfig } from "@/lib/api/config"
import type { WaiterAccessMode } from "@/lib/api/settings"
import { listStaff, removeStaffPin, setStaffPin, unlockStaffPin, type StaffMember } from "@/lib/api/staff"
import { roleLabel } from "@/lib/auth/roles"
import { clockTime, initialsOf } from "@/lib/terminal/format"
import { newPinError } from "@/lib/terminal/pin"
import { cn } from "@/lib/utils"
import { useProfileStore } from "@/store/useProfileStore"
import { SettingsPage } from "./SettingsPage"

/** Every member with their PIN state (admins included, unlike the Personal list). */
export const staffPinsKey = ["admin", "staff", "pins"] as const

/** Roles that use a PIN: they identify on a terminal (and admin/cashier authorize voids). */
const PIN_ROLES = ["admin", "cashier", "waiter"]

const MODES: { id: WaiterAccessMode; title: string; icon: ReactNode; points: string[]; who: string }[] = [
  {
    id: "own_accounts",
    title: "Cuenta propia",
    icon: <Smartphone className="h-5 w-5" aria-hidden />,
    points: [
      "Cada mesero entra con su correo y contraseña, en su teléfono o en una tablet.",
      "Cada pedido queda a nombre de quien inició sesión.",
      "El PIN solo se usa para autorizar anulaciones.",
    ],
    who: "Para restaurantes que dan un acceso a cada mesero.",
  },
  {
    id: "shared_terminal",
    title: "Terminal compartida",
    icon: <Tablet className="h-5 w-5" aria-hidden />,
    points: [
      "Una tablet la abre el admin o la caja; los meseros no inician sesión.",
      "Cada mesero toca su nombre y escribe su PIN; queda identificado 5 minutos.",
      "Desde la terminal no se entra a las pantallas de admin.",
    ],
    who: "Para un toma pedidos compartido entre varios meseros.",
  },
]

const isLocked = (member: StaffMember) =>
  member.pinLockedUntil !== null && new Date(member.pinLockedUntil).getTime() > Date.now()

/** "Julián no tiene PIN" / "Julián y Sara no tienen PIN" / "Julián, Sara y Pedro no tienen PIN". */
function missingPinSentence(names: string[]): string {
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`
  return `${list} ${names.length === 1 ? "no tiene PIN" : "no tienen PIN"}.`
}

/**
 * Ajustes → Acceso de meseros (F4, design/acceso-meseros/01-ajustes-acceso.html):
 * how waiters take orders (own accounts or a shared terminal with a personal
 * PIN), the PIN rules, and the PIN of every member. Nobody ever sees a PIN:
 * the admin only assigns, resets, removes or unlocks it early.
 */
export function WaiterAccessPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const me = useProfileStore((s) => s.authProfile)
  const [pendingMode, setPendingMode] = useState<WaiterAccessMode | null>(null)
  const [pinTarget, setPinTarget] = useState<StaffMember | null>(null)
  const [toRemove, setToRemove] = useState<StaffMember | null>(null)
  const [ownOpen, setOwnOpen] = useState(false)

  const configQuery = useQuery({ queryKey: CONFIG_QUERY_KEY, queryFn: fetchConfig })
  const staffQuery = useQuery({ queryKey: staffPinsKey, queryFn: listStaff })
  const mode = configQuery.data?.waiterAccessMode
  const members = (staffQuery.data ?? []).filter((member) => member.active)
  const waitersWithoutPin = members.filter((member) => member.role === "waiter" && !member.hasPin)

  const refreshStaff = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: staffPinsKey }),
      queryClient.invalidateQueries({ queryKey: catalogKeys.staff }),
    ])
  const fail = (err: unknown) =>
    toast({ title: "Error", description: err instanceof Error ? err.message : "Inténtalo de nuevo", variant: "destructive" })

  const saveMode = useMutation({
    mutationFn: (next: WaiterAccessMode) => saveConfig({ waiterAccessMode: next }),
    onSuccess: (saved) => {
      queryClient.setQueryData<BusinessConfig>(CONFIG_QUERY_KEY, (old: BusinessConfig | undefined) => ({ ...(old ?? {}), ...saved }) as BusinessConfig)
      toast({
        title: saved.waiterAccessMode === "shared_terminal" ? "Terminal compartida activa" : "Cuenta propia activa",
      })
    },
    onError: fail,
    onSettled: () => setPendingMode(null),
  })

  const remove = useMutation({
    mutationFn: (member: StaffMember) => removeStaffPin(member.id),
    onSuccess: (_, member) => {
      toast({ title: "PIN quitado", description: `${member.fullName} ya no tiene PIN.` })
      return refreshStaff()
    },
    onError: fail,
    onSettled: () => setToRemove(null),
  })

  const unlock = useMutation({
    mutationFn: (member: StaffMember) => unlockStaffPin(member.id),
    onSuccess: (_, member) => {
      toast({ title: "PIN desbloqueado", description: `${member.fullName} ya puede volver a escribir su PIN.` })
      return refreshStaff()
    },
    onError: fail,
  })

  const choose = (next: WaiterAccessMode) => {
    if (!mode || next === mode) return
    setPendingMode(next)
  }

  const meLabel = me ? `${me.name} · ${roleLabel(me.role) ?? me.role}` : undefined

  return (
    <SettingsPage
      title="Acceso de meseros"
      description="Elige cómo entran los meseros a tomar pedidos y quién tiene PIN para identificarse o autorizar anulaciones."
      actions={
        <Button variant="outline" className="min-h-11" onClick={() => setOwnOpen(true)}>
          <KeyRound className="mr-2 h-4 w-4" aria-hidden />
          Cambiar mi PIN
        </Button>
      }
    >
      <section aria-labelledby="access-mode-h" className="rounded-card border bg-card text-card-foreground">
        <div className="px-4 pb-1 pt-4 sm:px-5">
          <h2 id="access-mode-h" className="font-semibold">
            Cómo entran los meseros
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Aplica a todo el restaurante. Puedes cambiarlo cuando quieras; los pedidos abiertos no se pierden.
          </p>
        </div>
        {configQuery.isLoading ? (
          <div className="grid gap-3 p-4 sm:px-5 md:grid-cols-2">
            <Skeleton className="h-44" />
            <Skeleton className="h-44" />
          </div>
        ) : configQuery.isError ? (
          <p className="p-4 text-sm text-destructive sm:px-5">No se pudo cargar el modo de acceso.</p>
        ) : (
          <div role="radiogroup" aria-labelledby="access-mode-h" className="grid gap-3 p-4 sm:px-5 md:grid-cols-2">
            {MODES.map((option) => {
              const checked = option.id === mode
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  disabled={saveMode.isPending}
                  onClick={() => choose(option.id)}
                  className={cn(
                    "flex min-h-11 flex-col gap-3 rounded-card border p-4 text-left transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    checked ? "border-primary bg-primary/10 ring-2 ring-primary/40" : "bg-background hover:bg-muted/60",
                  )}
                >
                  <span className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className={cn(
                        "grid h-5 w-5 flex-none place-items-center rounded-full border-2",
                        checked ? "border-primary" : "border-muted-foreground/50",
                      )}
                    >
                      {checked && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
                    </span>
                    <span className="flex-1 font-semibold">{option.title}</span>
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-muted text-primary">{option.icon}</span>
                  </span>
                  <ul className="space-y-1.5 text-sm text-muted-foreground">
                    {option.points.map((point) => (
                      <li key={point} className="flex gap-2">
                        <Check className="mt-0.5 h-4 w-4 flex-none text-primary" aria-hidden />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                  <span className="border-t pt-2 text-xs text-muted-foreground">{option.who}</span>
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/*
        F1 slot: "Permitir que el supervisor se autorice a sí mismo" (switch,
        off by default; self-authorized voids are marked «autoautorizada»).
        Render it here once the business config field lands with F1; it is not
        in lib/api/schema.d.ts yet.
      */}

      <section aria-labelledby="pin-rules-h" className="rounded-card border bg-card p-4 text-card-foreground sm:px-5">
        <h2 id="pin-rules-h" className="font-semibold">
          Reglas del PIN
        </h2>
        <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {[
            "De 4 a 6 dígitos.",
            "No se aceptan PIN fáciles: 1111, 1234, 4321 o 1212.",
            "5 intentos fallidos bloquean el PIN 5 minutos.",
            "En la terminal, el mesero queda identificado 5 minutos.",
          ].map((rule) => (
            <li key={rule} className="flex gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-primary" aria-hidden />
              <span>{rule}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="staff-pins-h" className="rounded-card border bg-card text-card-foreground">
        <div className="px-4 pb-3 pt-4 sm:px-5">
          <h2 id="staff-pins-h" className="font-semibold">
            PIN del personal
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Nadie ve el PIN de otra persona: solo se asigna, se restablece o se quita.
          </p>
        </div>
        {staffQuery.isLoading ? (
          <div className="space-y-2 px-4 pb-4 sm:px-5">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : staffQuery.isError ? (
          <p className="px-4 pb-4 text-sm text-destructive sm:px-5">No se pudo cargar el personal.</p>
        ) : (
          <div role="table" aria-label="PIN del personal" className="border-t">
            <div
              role="row"
              className="hidden grid-cols-[minmax(0,1.6fr)_7rem_minmax(0,1.2fr)_minmax(0,1.4fr)] gap-3 border-b px-5 py-2 text-xs uppercase tracking-wide text-muted-foreground md:grid"
            >
              <span role="columnheader">Persona</span>
              <span role="columnheader">Rol</span>
              <span role="columnheader">Estado del PIN</span>
              <span role="columnheader" className="sr-only">
                Acciones
              </span>
            </div>
            {members.map((member) => {
              const own = member.id === me?.id
              const locked = isLocked(member)
              return (
                <div
                  key={member.id}
                  role="row"
                  className="grid grid-cols-1 gap-2 border-b px-4 py-3 last:border-b-0 sm:px-5 md:grid-cols-[minmax(0,1.6fr)_7rem_minmax(0,1.2fr)_minmax(0,1.4fr)] md:items-center md:gap-3"
                >
                  <span role="cell" className="flex min-w-0 items-center gap-3">
                    <span
                      aria-hidden
                      className="grid h-10 w-10 flex-none place-items-center rounded-full bg-primary/10 font-semibold text-primary"
                    >
                      {initialsOf(member.fullName)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{member.fullName}</span>
                      {own && <span className="block text-xs text-muted-foreground">Tú</span>}
                    </span>
                  </span>
                  <span role="cell" className="text-sm text-muted-foreground md:text-foreground">
                    {roleLabel(member.role) ?? member.role}
                  </span>
                  <span role="cell">
                    <PinState member={member} locked={locked} />
                  </span>
                  <span role="cell" className="flex flex-wrap gap-2 md:justify-end">
                    {locked && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="min-h-11"
                        disabled={unlock.isPending}
                        onClick={() => unlock.mutate(member)}
                      >
                        Desbloquear
                      </Button>
                    )}
                    {own && member.hasPin ? (
                      <Button size="sm" variant="outline" className="min-h-11" onClick={() => setOwnOpen(true)}>
                        Cambiar mi PIN
                      </Button>
                    ) : member.hasPin ? (
                      <>
                        <Button size="sm" variant="outline" className="min-h-11" onClick={() => setPinTarget(member)}>
                          Restablecer
                        </Button>
                        <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setToRemove(member)}>
                          Quitar
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant={member.role === "waiter" ? "default" : "outline"}
                        className="min-h-11"
                        onClick={() => setPinTarget(member)}
                      >
                        Asignar PIN
                      </Button>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <AlertDialog open={pendingMode !== null} onOpenChange={(open) => !open && setPendingMode(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingMode === "shared_terminal" ? "¿Usar terminal compartida?" : "¿Volver a cuenta propia?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {pendingMode === "shared_terminal" ? (
                  <>
                    <p>Cada pedido de la terminal pedirá el PIN del mesero que lo toma.</p>
                    {waitersWithoutPin.length > 0 ? (
                      <p className="rounded-lg border border-status-warning-line bg-status-warning-bg px-3 py-2 text-status-warning-fg">
                        <b>{missingPinSentence(waitersWithoutPin.map((m) => m.fullName))}</b> No podrá
                        {waitersWithoutPin.length === 1 ? "" : "n"} tomar pedidos en la terminal hasta que le asignes uno.
                      </p>
                    ) : (
                      <p>Todos los meseros activos tienen PIN.</p>
                    )}
                  </>
                ) : (
                  <p>Cada mesero vuelve a entrar con su propia cuenta. Los pedidos abiertos no se pierden.</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              disabled={saveMode.isPending}
              onClick={(event) => {
                event.preventDefault()
                if (pendingMode) saveMode.mutate(pendingMode)
              }}
            >
              {pendingMode === "shared_terminal" ? "Usar terminal compartida" : "Usar cuenta propia"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={toRemove !== null} onOpenChange={(open) => !open && setToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Quitar el PIN de {toRemove?.fullName}?</AlertDialogTitle>
            <AlertDialogDescription>
              No podrá identificarse en la terminal ni autorizar anulaciones hasta que le asignes otro.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancelar</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={() => toRemove && remove.mutate(toRemove)}>
              Quitar PIN
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <StaffPinDialog member={pinTarget} onClose={() => setPinTarget(null)} onSaved={refreshStaff} />
      <ChangeOwnPinDialog open={ownOpen} onOpenChange={setOwnOpen} who={meLabel} />
    </SettingsPage>
  )
}

function PinState({ member, locked }: { member: StaffMember; locked: boolean }) {
  const chip = "inline-flex min-h-6 max-w-full items-center rounded-pill border px-2.5 py-0.5 text-xs font-medium"
  if (locked) {
    return (
      <span className={cn(chip, "border-status-danger-line bg-status-danger-bg text-status-danger-fg")}>
        Bloqueado hasta {clockTime(member.pinLockedUntil!)}
      </span>
    )
  }
  if (member.hasPin) {
    return <span className={cn(chip, "border-status-ok-line bg-status-ok-bg text-status-ok-fg")}>Tiene PIN</span>
  }
  if (PIN_ROLES.includes(member.role)) {
    return <span className={cn(chip, "border-status-warning-line bg-status-warning-bg text-status-warning-fg")}>Sin PIN</span>
  }
  return (
    <span className={cn(chip, "border-status-reserved-line bg-status-reserved-bg text-status-reserved-fg")}>
      Sin PIN · no lo necesita
    </span>
  )
}

/** Assign or reset a member's PIN: typed twice; the API refuses weak PINs in Spanish. */
function StaffPinDialog({
  member,
  onClose,
  onSaved,
}: {
  member: StaffMember | null
  onClose: () => void
  onSaved: () => Promise<unknown>
}) {
  const { toast } = useToast()
  const [pin, setPin] = useState("")
  const [again, setAgain] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const close = () => {
    setPin("")
    setAgain("")
    setError(null)
    onClose()
  }

  const submit = async () => {
    if (!member) return
    const local = newPinError(pin, again)
    if (local) {
      setError(local)
      return
    }
    setSaving(true)
    try {
      await setStaffPin(member.id, pin)
      toast({ title: member.hasPin ? "PIN restablecido" : "PIN asignado", description: `Dale el PIN a ${member.fullName} en persona.` })
      close()
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el PIN")
    } finally {
      setSaving(false)
    }
  }

  const title = member ? (member.hasPin ? `Restablecer el PIN de ${member.fullName}` : `Asignar PIN a ${member.fullName}`) : ""

  return (
    <Dialog open={member !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-[460px]">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              Dale el PIN a {member?.fullName} en persona. Podrá cambiarlo después desde su cuenta.
            </DialogDescription>
          </DialogHeader>
          <PinField label="PIN nuevo" value={pin} onChange={setPin} describedBy="staff-pin-rules" invalid={!!error} autoFocus />
          <p id="staff-pin-rules" className="text-xs text-muted-foreground">
            De 4 a 6 dígitos. Evita un mismo dígito (1111), secuencias (1234, 4321) y bloques repetidos (1212).
          </p>
          <PinField label="Repite el PIN" value={again} onChange={setAgain} invalid={!!error} />
          <PinFormError message={error} />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={close}>
              Cancelar
            </Button>
            <Button type="submit" className="min-h-11" disabled={saving}>
              Guardar PIN
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
