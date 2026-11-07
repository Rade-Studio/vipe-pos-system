"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/cashier/cashier-ui"
import { ROLE_LABEL, lockedUntilLabel, type Supervisor } from "@/components/voids/flow"
import { Alert, Avatar, Option, Options, PinDots, PinPad, StepHeader } from "@/components/voids/sheet"
import { SUPERVISORS_QUERY_KEY, loadSupervisors } from "@/components/voids/supervisors"
import { PIN_MAX_LENGTH } from "@/lib/terminal/pin"

/**
 * The steps of the shared terminal's sheet (F4b), with the look of the F3
 * void sheet (components/voids/sheet.tsx): PIN, supervisor tiles and the
 * "unsent products of someone else" warning.
 */

const PIN_MIN = 4

function Footer({ children }: { children: ReactNode }) {
  return <footer className="flex gap-2 border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{children}</footer>
}

interface PinStepProps {
  eyebrow: string
  title: string
  /** Who types, for a supervisor step. */
  person?: { name: string; role: string }
  alert?: ReactNode
  /** No digit can be typed (a locked tablet or supervisor). */
  locked?: boolean
  submitLabel: string
  /** Resolves when the answer is known; the typed PIN is then cleared. */
  onSubmit: (pin: string) => Promise<void>
  below?: ReactNode
  footer?: ReactNode
}

/** A PIN pad of 56 px keys; digits, Backspace and Enter also work on a keyboard. */
export function PinStep({ eyebrow, title, person, alert, locked = false, submitLabel, onSubmit, below, footer }: PinStepProps) {
  const [pin, setPin] = useState("")
  const [busy, setBusy] = useState(false)
  const disabled = locked || busy

  const press = useCallback((digit: string) => setPin((current) => (current.length < PIN_MAX_LENGTH ? current + digit : current)), [])
  const erase = useCallback(() => setPin((current) => current.slice(0, -1)), [])
  const submit = useCallback(async () => {
    if (pin.length < PIN_MIN || disabled) return
    setBusy(true)
    try {
      await onSubmit(pin)
    } finally {
      setPin("")
      setBusy(false)
    }
  }, [pin, disabled, onSubmit])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (disabled) return
      if (/^[0-9]$/.test(event.key)) press(event.key)
      else if (event.key === "Backspace") erase()
      else if (event.key === "Enter") void submit()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [disabled, press, erase, submit])

  return (
    <>
      <StepHeader eyebrow={eyebrow} title={title} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-4 pt-1">
        {person && (
          <div className="flex items-center gap-3">
            <Avatar name={person.name} />
            <span className="min-w-0 flex-1">
              <b className="block break-words">{person.name}</b>
              <small className="text-xs text-muted-fg">{ROLE_LABEL[person.role as Supervisor["role"]] ?? person.role} · escribe tu PIN</small>
            </span>
          </div>
        )}
        {alert}
        <PinDots length={pin.length} wrong={false} />
        <p className="text-center text-xs text-muted-fg">PIN de 4 a 6 dígitos</p>
        <PinPad
          disabled={disabled}
          canSubmit={pin.length >= PIN_MIN && !disabled}
          busy={busy}
          onDigit={press}
          onDelete={erase}
          onSubmit={() => void submit()}
          submitLabel={submitLabel}
        />
        {below}
      </div>
      {footer && <Footer>{footer}</Footer>}
    </>
  )
}

interface SupervisorStepProps {
  eyebrow: string
  title: string
  note: string
  /** Supervisor locks this tablet learned from a 429 (ISO), per profile. */
  locks: Record<string, string>
  onPick: (supervisor: Supervisor) => void
  onBack?: () => void
}

/** The admins and cashiers of GET /staff/supervisors (never the waiters); those without PIN are disabled. */
export function SupervisorStep({ eyebrow, title, note, locks, onPick, onBack }: SupervisorStepProps) {
  const supervisors = useQuery({ queryKey: SUPERVISORS_QUERY_KEY, queryFn: loadSupervisors })
  return (
    <>
      <StepHeader eyebrow={eyebrow} title={title} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-4 pt-1">
        {supervisors.isLoading ? (
          <p className="text-sm text-muted-fg" aria-busy="true">
            Cargando…
          </p>
        ) : supervisors.isError ? (
          <Alert tone="danger">No se pudo cargar quién puede hacerlo. Revisa la conexión.</Alert>
        ) : (
          <Options label="Quién confirma">
            {(supervisors.data ?? []).map((supervisor) => {
              const until = lockedUntilLabel(locks[supervisor.id] ?? supervisor.pinLockedUntil)
              return (
                <Option key={supervisor.id} checked={false} disabled={!supervisor.hasPin} onSelect={() => supervisor.hasPin && onPick(supervisor)}>
                  <Avatar name={supervisor.fullName} />
                  <span className="min-w-0 flex-1">
                    <b className="block break-words">{supervisor.fullName}</b>
                    <small className="text-xs text-muted-fg">{ROLE_LABEL[supervisor.role]}</small>
                  </span>
                  {!supervisor.hasPin ? <Chip tone="reserved">Sin PIN</Chip> : until ? <Chip tone="danger">Bloqueado hasta {until}</Chip> : null}
                </Option>
              )
            })}
          </Options>
        )}
        <p className="text-xs text-muted-fg">{note}</p>
      </div>
      {onBack && (
        <Footer>
          <Button variant="outline" className="h-12 flex-1 text-base" onClick={onBack}>
            Atrás
          </Button>
        </Footer>
      )}
    </>
  )
}

interface WarningStepProps {
  label: string
  owner: string
  count: number
  onContinue: () => void
  onDiscard: () => void
}

/** Someone else left unsent products on this table: keep them (sent as the new person) or discard them. */
export function WarningStep({ label, owner, count, onContinue, onDiscard }: WarningStepProps) {
  const products = count === 1 ? "1 producto" : `${count} productos`
  return (
    <>
      <StepHeader eyebrow={label} title={`${owner} dejó ${products} sin enviar`} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-4 pt-1">
        <Alert tone="warning">
          Si continúas, se envían a cocina a tu nombre. Si los descartas, se borran del pedido sin enviar.
        </Alert>
      </div>
      <Footer>
        <Button variant="outline" className="h-12 flex-1 text-base" onClick={onDiscard}>
          Descartar
        </Button>
        <Button className="h-12 flex-1 text-base" onClick={onContinue}>
          Continuar
        </Button>
      </Footer>
    </>
  )
}
