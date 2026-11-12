"use client"

import { useEffect, useId, useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/utils/helpers"
import { toast } from "@/utils/toast"
import { authorizeSupervisor, pinFailureOf } from "@/lib/api/auth"
import type { PromotionDto } from "@/lib/api/catalog"
import { CONFIG_QUERY_KEY, fetchConfig } from "@/lib/api/config"
import { addOrderDiscount, discountRefusalOf, removeOrderDiscount } from "@/lib/api/discounts"
import {
  discountBody,
  freeValueError,
  needsPin,
  reasonError,
  type CashierDiscountLine,
  type DiscountChoice,
  type FreeDiscountType,
} from "@/lib/cashier/discounts"
import { useProfileStore } from "@/store/useProfileStore"
import {
  ROLE_LABEL,
  firstName,
  lockedUntilLabel,
  supervisorTiles,
  type Supervisor,
  type SupervisorTile,
} from "@/components/voids/flow"
import { Alert, Avatar, Option, Options, PinDots, PinPad, StepHeader, StepSheet } from "@/components/voids/sheet"
import { SUPERVISORS_QUERY_KEY, loadSupervisors as defaultLoadSupervisors } from "@/components/voids/supervisors"
import { Chip, Money, focusRing } from "./cashier-ui"

/**
 * S13 (design/promociones/03, "Agregar cortesía o descuento"): a manual
 * promotion or a free discount (% o valor) on a product or the whole bill,
 * with a reason and, for `manual_pin` and free discounts, the supervisor
 * PIN of the void sheet bound to `apply_discount` and the order. Removing a
 * manual discount uses the same rule.
 */

export interface DiscountSheetLine {
  itemId: string
  orderId: string
  name: string
  unitPrice: number
  quantity: number
}

export type DiscountSheetTarget =
  | {
      mode: "add"
      /** "Mesa 7". */
      label: string
      lines: DiscountSheetLine[]
      /** The order a discount on "Toda la cuenta" goes to. */
      billOrderId: string
      promotions: PromotionDto[]
    }
  | { mode: "remove"; label: string; discount: CashierDiscountLine; requiresPin: boolean }

interface DiscountSheetProps {
  target: DiscountSheetTarget | null
  onClose: () => void
  /** The discount was stored: refresh the order. */
  onApplied: () => void | Promise<void>
  loadSupervisors?: () => Promise<Supervisor[]>
}

const PIN_MIN = 4
const PIN_MAX = 6
const BILL = "bill"
const FREE = "free"

type Step = "form" | "who" | "pin"
type Problem =
  | { kind: "self" }
  | { kind: "wrong" }
  | { kind: "locked"; until: string | null; message: string }
  | { kind: "refusal"; message: string }

export function DiscountSheet({ target, onClose, onApplied, loadSupervisors = defaultLoadSupervisors }: DiscountSheetProps) {
  return (
    <StepSheet open={target !== null} onClose={onClose}>
      {target && <SheetBody target={target} onClose={onClose} onApplied={onApplied} loadSupervisors={loadSupervisors} />}
    </StepSheet>
  )
}

function SheetBody({
  target,
  onClose,
  onApplied,
  loadSupervisors,
}: { target: DiscountSheetTarget } & Required<Omit<DiscountSheetProps, "target">>) {
  const authProfile = useProfileStore((s) => s.authProfile)
  const reasonId = useId()
  const valueId = useId()

  const [step, setStep] = useState<Step>("form")
  const [choiceId, setChoiceId] = useState<string | null>(
    target.mode === "add" && target.promotions.length === 1 ? target.promotions[0]!.id : null,
  )
  const [freeType, setFreeType] = useState<FreeDiscountType>("percentage")
  const [freeValue, setFreeValue] = useState("")
  const [itemId, setItemId] = useState<string | null>(
    target.mode === "add" && target.lines.length === 1 ? target.lines[0]!.itemId : null,
  )
  const [reason, setReason] = useState("")
  const [touched, setTouched] = useState(false)
  const [supervisorId, setSupervisorId] = useState<string | null>(null)
  const [pin, setPin] = useState("")
  const [problem, setProblem] = useState<Problem | null>(null)
  const [busy, setBusy] = useState(false)

  const add = target.mode === "add"
  const promotion = add ? target.promotions.find((candidate) => candidate.id === choiceId) : undefined
  const choice: DiscountChoice | null = !add
    ? null
    : choiceId === FREE
      ? { type: "free", discountType: freeType, value: Number(freeValue) }
      : promotion
        ? { type: "promotion", promotion }
        : null
  // A bill promotion goes to the bill; a product promotion needs a product.
  const billOnly = promotion?.kind === "bill_discount"
  const productOnly = promotion?.kind === "product_discount"
  const selectedItem = billOnly ? BILL : itemId
  const line = add ? target.lines.find((candidate) => candidate.itemId === selectedItem) : undefined
  const pinNeeded = add ? (choice ? needsPin(choice) : true) : target.requiresPin

  const reasonProblem = add ? reasonError(reason) : null
  const valueProblem = choice?.type === "free" ? freeValueError(freeType, Number(freeValue)) : null
  // Every incomplete form says what is missing, so "Aplicar" never does nothing.
  const choiceProblem = !add
    ? null
    : choice === null
      ? "Elige qué se aplica."
      : selectedItem === null || (productOnly && selectedItem === BILL)
        ? "Elige un producto o Toda la cuenta."
        : null
  const formReady = !add || (!choiceProblem && !reasonProblem && !valueProblem)

  const orderId = add ? (line?.orderId ?? target.billOrderId) : target.discount.orderId

  const config = useQuery({ queryKey: CONFIG_QUERY_KEY, queryFn: fetchConfig, enabled: pinNeeded })
  const supervisors = useQuery({
    queryKey: SUPERVISORS_QUERY_KEY,
    queryFn: loadSupervisors,
    enabled: pinNeeded,
    refetchOnMount: "always",
    retry: false,
  })
  const tiles = supervisorTiles(supervisors.data ?? [], authProfile?.id, config.data?.allowSelfAuthorization === true)
  const supervisor = tiles.find((tile) => tile.id === supervisorId) ?? null
  const locked = problem?.kind === "locked"

  const submit = async (authorizationId?: string) => {
    try {
      if (target.mode === "add") {
        await addOrderDiscount(orderId, discountBody(choice!, line?.itemId ?? null, reason, authorizationId))
      } else {
        await removeOrderDiscount(orderId, target.discount.id, authorizationId)
      }
    } catch (error) {
      const refusal = discountRefusalOf(error)
      setPin("")
      setProblem({ kind: "refusal", message: refusal.message })
      // A spent authorization asks for the PIN again; any other refusal keeps the form as it was.
      setStep(refusal.reauthorize && pinNeeded ? "who" : "form")
      return
    }
    toast.success(target.mode === "add" ? "Descuento aplicado" : "Descuento quitado")
    try {
      await onApplied()
    } catch {
      toast.error("El descuento se guardó, pero la cuenta no se actualizó. Toca Reintentar.")
    }
    onClose()
  }

  const primary = async () => {
    setTouched(true)
    if (!formReady || busy) return
    setProblem(null)
    if (pinNeeded) {
      setStep("who")
      return
    }
    setBusy(true)
    await submit()
    setBusy(false)
  }

  const authorize = async () => {
    if (!supervisor || pin.length < PIN_MIN || busy || locked) return
    setBusy(true)
    setProblem(null)
    let authorizationId: string
    try {
      const authorization = await authorizeSupervisor({
        pin,
        action: "apply_discount",
        profileId: supervisor.id,
        targetType: "order",
        targetId: orderId,
      })
      authorizationId = authorization.authorizationId
    } catch (error) {
      setPin("")
      const failure = pinFailureOf(error)
      if (failure.kind === "wrong") setProblem({ kind: "wrong" })
      else if (failure.kind === "locked") {
        const fresh = (await supervisors.refetch()).data?.find((member) => member.id === supervisor.id)
        setProblem({ kind: "locked", until: fresh?.pinLockedUntil ?? null, message: failure.message })
      } else setProblem({ kind: "refusal", message: failure.message })
      setBusy(false)
      return
    }
    await submit(authorizationId)
    setBusy(false)
  }

  const pickSupervisor = (tile: SupervisorTile) => {
    if (!tile.hasPin) return
    if (tile.refused) {
      setProblem({ kind: "self" })
      return
    }
    setSupervisorId(tile.id)
    setPin("")
    const until = lockedUntilLabel(tile.pinLockedUntil)
    setProblem(until ? { kind: "locked", until: tile.pinLockedUntil, message: "" } : null)
    setStep("pin")
  }

  const press = (digit: string) => {
    if (locked || busy) return
    setPin((current) => (current.length < PIN_MAX ? current + digit : current))
    if (problem?.kind === "wrong" || problem?.kind === "refusal") setProblem(null)
  }

  // A hardware keyboard types the PIN too.
  useEffect(() => {
    if (step !== "pin") return
    const onKey = (event: KeyboardEvent) => {
      if (/^[0-9]$/.test(event.key)) press(event.key)
      else if (event.key === "Backspace") setPin((current) => current.slice(0, -1))
      else if (event.key === "Enter") void authorize()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const eyebrow = `${add ? "Cortesía o descuento" : "Quitar descuento"} · ${target.label}`
  const refusal = problem?.kind === "refusal" && <Alert tone="danger">{problem.message}</Alert>
  const footer = (children: ReactNode) => (
    <footer className="flex gap-2 border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{children}</footer>
  )
  const back = (to: Step) => (
    <Button
      variant="outline"
      className="h-12 flex-1 text-base"
      onClick={() => {
        setProblem(null)
        setPin("")
        setStep(to)
      }}
    >
      Atrás
    </Button>
  )

  if (step === "form") {
    if (target.mode === "remove") {
      return (
        <>
          <StepHeader eyebrow={eyebrow} title="¿Quitar este descuento?" />
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-4 pt-1">
            <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm">
              <b className="min-w-0 break-words">{target.discount.label}</b>
              <Money>−{formatCurrency(target.discount.amount)}</Money>
            </div>
            <p className="text-sm text-fg-2">La cuenta vuelve a subir en ese valor.</p>
            {refusal}
          </div>
          {footer(
            <>
              <Button variant="outline" className="h-12 flex-1 text-base" onClick={onClose}>
                Cancelar
              </Button>
              <Button className="h-12 flex-1 text-base" onClick={() => void primary()} disabled={busy}>
                {target.requiresPin ? "Autorizar y quitar" : "Quitar descuento"}
              </Button>
            </>,
          )}
        </>
      )
    }
    return (
      <>
        <StepHeader eyebrow={eyebrow} title="Agregar cortesía o descuento" />
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-4 pt-1">
          <div>
            <p className="mb-2 text-sm font-semibold text-fg-2">Qué se aplica</p>
            <Options label="Qué se aplica">
              {target.promotions.map((candidate) => (
                <Option key={candidate.id} checked={choiceId === candidate.id} onSelect={() => setChoiceId(candidate.id)}>
                  <span className="min-w-0 flex-1">
                    <b className="block break-words">{candidate.name}</b>
                    <small className="text-xs text-muted-fg">{candidate.sentence}</small>
                  </span>
                  {candidate.mode === "manual_pin" && <Chip tone="reserved">PIN</Chip>}
                </Option>
              ))}
              <Option checked={choiceId === FREE} onSelect={() => setChoiceId(FREE)}>
                <span className="min-w-0 flex-1">
                  <b className="block">Descuento manual</b>
                  <small className="text-xs text-muted-fg">% o valor sobre un producto o la cuenta</small>
                </span>
                <Chip tone="reserved">PIN</Chip>
              </Option>
            </Options>
          </div>

          {choiceId === FREE && (
            <div className="grid gap-2">
              <div role="radiogroup" aria-label="Tipo de descuento" className="flex gap-2">
                {(
                  [
                    ["percentage", "%"],
                    ["fixed_amount", "Valor"],
                  ] as const
                ).map(([type, text]) => (
                  <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={freeType === type}
                    onClick={() => setFreeType(type)}
                    className={cn(
                      "min-h-[44px] flex-1 rounded-lg border px-3 text-sm font-semibold",
                      freeType === type ? "border-brand bg-brand-tint" : "border-line bg-surface",
                      focusRing,
                    )}
                  >
                    {text}
                  </button>
                ))}
              </div>
              <label htmlFor={valueId} className="text-sm font-semibold text-fg-2">
                {freeType === "percentage" ? "Porcentaje" : "Valor en pesos"}
              </label>
              <Input
                id={valueId}
                inputMode="numeric"
                autoComplete="off"
                value={freeValue}
                onChange={(event) => setFreeValue(event.target.value.replace(/[^\d]/g, ""))}
                className="h-11"
              />
              {touched && valueProblem && <p className="text-sm text-status-danger-fg">{valueProblem}</p>}
            </div>
          )}

          <div>
            <p className="mb-2 text-sm font-semibold text-fg-2">Producto</p>
            <Options label="Producto">
              {target.lines.map((candidate) => (
                <Option
                  key={candidate.itemId}
                  checked={selectedItem === candidate.itemId}
                  disabled={billOnly}
                  onSelect={() => !billOnly && setItemId(candidate.itemId)}
                >
                  <span className="min-w-0 flex-1 break-words">
                    <b>{candidate.name}</b> · <Money>{formatCurrency(candidate.unitPrice * candidate.quantity)}</Money>
                    {candidate.quantity > 1 && <small className="text-xs text-muted-fg"> ×{candidate.quantity}</small>}
                  </span>
                </Option>
              ))}
              <Option checked={selectedItem === BILL} disabled={productOnly} onSelect={() => !productOnly && setItemId(BILL)}>
                <b className="min-w-0 flex-1">Toda la cuenta</b>
              </Option>
            </Options>
          </div>

          <div className="grid gap-2">
            <label htmlFor={reasonId} className="text-sm font-semibold text-fg-2">
              Motivo
            </label>
            <Input
              id={reasonId}
              autoComplete="off"
              maxLength={200}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ej. cumpleaños de la mesa"
              className="h-11"
            />
            {touched && reasonProblem && <p className="text-sm text-status-danger-fg">{reasonProblem}</p>}
          </div>
          {touched && choiceProblem && <p className="text-sm text-status-danger-fg">{choiceProblem}</p>}
          {refusal}
        </div>
        {footer(
          <>
            <Button variant="outline" className="h-12 flex-1 text-base" onClick={onClose}>
              Cancelar
            </Button>
            <Button className="h-12 flex-1 text-base" onClick={() => void primary()} disabled={busy}>
              {pinNeeded ? "Autorizar y aplicar" : "Aplicar"}
            </Button>
          </>,
        )}
      </>
    )
  }

  if (step === "who") {
    return (
      <>
        <StepHeader eyebrow={eyebrow} title="¿Quién autoriza?" />
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-4 pt-1">
          {refusal}
          <p className="text-sm text-fg-2">Elige a la persona que autoriza. Después escribe su PIN.</p>
          {supervisors.isLoading ? (
            <p className="text-sm text-muted-fg" aria-busy="true">
              Cargando quién autoriza…
            </p>
          ) : supervisors.isError ? (
            <Alert tone="danger">
              No se pudo cargar quién autoriza.{" "}
              <button
                type="button"
                className={cn("inline-flex min-h-[44px] items-center px-1 font-semibold underline", focusRing)}
                onClick={() => void supervisors.refetch()}
              >
                Reintentar
              </button>
            </Alert>
          ) : (
            <>
              {!tiles.some((tile) => tile.hasPin) && (
                <Alert tone="warning">Nadie tiene PIN de supervisor. El admin lo asigna en Configuración → Acceso de meseros.</Alert>
              )}
              {tiles.length > 0 && (
                <Options label="Quién autoriza">
                  {tiles.map((tile) => {
                    const until = lockedUntilLabel(tile.pinLockedUntil)
                    return (
                      <Option
                        key={tile.id}
                        checked={false}
                        disabled={tile.refused || !tile.hasPin}
                        danger={tile.refused && problem?.kind === "self"}
                        onSelect={() => pickSupervisor(tile)}
                      >
                        <Avatar name={tile.fullName} />
                        <span className="min-w-0 flex-1">
                          <b className="block break-words">{tile.fullName}</b>
                          <small className="text-xs text-muted-fg">
                            {ROLE_LABEL[tile.role]}
                            {tile.self ? " · eres tú" : ""}
                          </small>
                        </span>
                        {!tile.hasPin ? (
                          <Chip tone="reserved">Sin PIN</Chip>
                        ) : tile.refused ? (
                          <Chip tone="reserved">Otra persona</Chip>
                        ) : until ? (
                          <Chip tone="danger">Bloqueado hasta {until}</Chip>
                        ) : null}
                      </Option>
                    )
                  })}
                </Options>
              )}
            </>
          )}
          {problem?.kind === "self" && (
            <Alert tone="danger">
              <b>Debe autorizar otra persona.</b> Tu PIN no sirve para tus propios descuentos.
            </Alert>
          )}
          <p className="text-xs text-muted-fg">Solo admin y cajeros con PIN pueden autorizar.</p>
        </div>
        {footer(back("form"))}
      </>
    )
  }

  const name = supervisor?.fullName ?? ""
  const untilLabel = problem?.kind === "locked" ? lockedUntilLabel(problem.until) : null
  return (
    <>
      <StepHeader eyebrow={eyebrow} title={`${firstName(name)}, escribe tu PIN`} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-4 pt-1">
        {supervisor && (
          <div className="flex items-center gap-3">
            <Avatar name={name} />
            <span className="min-w-0 flex-1">
              <b className="block break-words">{name}</b>
              <small className="text-xs text-muted-fg">{ROLE_LABEL[supervisor.role]} · escribe tu PIN</small>
            </span>
          </div>
        )}
        {problem?.kind === "wrong" && (
          <Alert tone="danger">
            <b>PIN incorrecto.</b> Revisa e inténtalo de nuevo; al quinto error seguido el PIN de {firstName(name)} se bloquea 5 minutos.
          </Alert>
        )}
        {problem?.kind === "locked" &&
          (untilLabel ? (
            <Alert tone="danger">
              <b>Bloqueado hasta {untilLabel}.</b> Pide a otra persona que autorice o espera.
            </Alert>
          ) : (
            <Alert tone="danger">{problem.message}</Alert>
          ))}
        {refusal}
        <PinDots length={pin.length} wrong={problem?.kind === "wrong"} />
        <p className="text-center text-xs text-muted-fg">PIN de 4 a 6 dígitos</p>
        <PinPad
          disabled={locked || busy}
          canSubmit={pin.length >= PIN_MIN && !locked && !busy}
          busy={busy}
          onDigit={press}
          onDelete={() => setPin((current) => current.slice(0, -1))}
          onSubmit={() => void authorize()}
          submitLabel={add ? "Aplicar" : "Quitar"}
        />
      </div>
      {footer(back("who"))}
    </>
  )
}
