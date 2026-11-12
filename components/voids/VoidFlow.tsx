"use client"

import { useEffect, useId, useState } from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { useQuery } from "@tanstack/react-query"
import { Check, Minus, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Chip, Money, focusRing } from "@/components/cashier/cashier-ui"
import { VoidDiscountNote } from "@/components/cashier/VoidDiscountNote"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/utils/helpers"
import { authorizeSupervisor, pinFailureOf } from "@/lib/api/auth"
import { VOID_REASONS, voidRefusalOf, type VoidReasonCode } from "@/lib/api/audit"
import { CONFIG_QUERY_KEY, fetchConfig } from "@/lib/api/config"
import { cancelDelivery } from "@/lib/api/delivery"
import { cancelOrder, getById, voidOrderItems, type OrderDto } from "@/lib/api/orders"
import { voidPayment } from "@/lib/api/payments"
import { useProfileStore } from "@/store/useProfileStore"
import { modifierLabel } from "@/lib/modifiers/rules"
import {
  ROLE_LABEL,
  SUPERVISOR_ACTION,
  authorizationTarget,
  canContinue,
  firstName,
  lockedUntilLabel,
  reasonTextError,
  supervisorTiles,
  type Supervisor,
  type SupervisorTile,
  type VoidAction,
  type VoidTarget,
} from "./flow"
import { Alert, Avatar, Option, Options, PinPad, StepSheet } from "./sheet"
import { SUPERVISORS_QUERY_KEY, loadSupervisors as defaultLoadSupervisors } from "./supervisors"

export interface VoidActor {
  id: string
  name: string
  role: string
}

export interface VoidResult {
  action: VoidAction
  orderId: string
  paymentId?: string
  /** Item void: the order with its bill recomputed. */
  order?: OrderDto
}

interface VoidFlowProps {
  /** What to cancel or void; null keeps the sheet closed. */
  target: VoidTarget | null
  onClose: () => void
  /** The void was stored: refresh what the screen shows. */
  onDone?: (result: VoidResult) => void
  /** Who asks; defaults to the signed-in profile. */
  actor?: VoidActor
  loadSupervisors?: () => Promise<Supervisor[]>
}

const COPY: Record<VoidAction, { eyebrow: string; question: string; done: string; note: string; back: string }> = {
  item: {
    eyebrow: "Anular plato",
    question: "¿Qué plato y por qué?",
    done: "Plato anulado",
    note: "Ya salió a cocina: la anulación queda registrada y el inventario no se devuelve.",
    back: "Volver a la orden",
  },
  order: {
    eyebrow: "Cancelar orden",
    question: "¿Por qué se cancela?",
    done: "Orden cancelada",
    note: "La orden no se borra: pasa a Canceladas con su motivo y quién autorizó.",
    back: "Listo",
  },
  payment: {
    eyebrow: "Anular pago",
    question: "¿Qué pago y por qué?",
    done: "Pago anulado",
    note: "El pago anulado deja de contar en caja y la orden se puede cobrar de nuevo.",
    back: "Volver a la caja",
  },
}

/** F3b: a Domicilio is cancelled from Domicilios with the same sheet. */
const DELIVERY_COPY = {
  eyebrow: "Cancelar domicilio",
  question: "¿Por qué se cancela?",
  done: "Domicilio cancelado",
  note: "El domicilio no se borra: pasa a Canceladas con su motivo y quién lo canceló.",
  back: "Listo",
}

const PIN_MIN = 4
const PIN_MAX = 6

type Step = "what" | "who" | "pin" | "done"
type Problem =
  | { kind: "self" }
  | { kind: "expired" }
  | { kind: "wrong" }
  | { kind: "locked"; until: string | null; message: string }
  | { kind: "refusal"; message: string }

const targetKey = (target: VoidTarget) =>
  `${target.action}:${target.orderId}:${target.action === "item" ? (target.lineId ?? "") : target.action === "payment" ? (target.paymentId ?? "") : ""}`

/**
 * F3 — the "hoja por pasos" of every cancellation and void
 * (design/anulaciones/01, L16): a bottom sheet on a phone, a dialog from 768 px.
 * 1 qué y motivo · 2 quién autoriza (supervisor tiles, never a bare PIN box) ·
 * 3 PIN · listo. The PIN buys an authorization bound to this action and target
 * (POST /auth/authorize) and the void endpoint consumes it at once.
 */
export function VoidFlow({ target, onClose, onDone, actor, loadSupervisors = defaultLoadSupervisors }: VoidFlowProps) {
  return (
    <StepSheet open={target !== null} onClose={onClose}>
      {target && <FlowBody key={targetKey(target)} target={target} onClose={onClose} onDone={onDone} actor={actor} loadSupervisors={loadSupervisors} />}
    </StepSheet>
  )
}

function FlowBody({
  target,
  onClose,
  onDone,
  actor: actorProp,
  loadSupervisors,
}: Required<Pick<VoidFlowProps, "onClose" | "loadSupervisors">> & Omit<VoidFlowProps, "onClose" | "loadSupervisors"> & { target: VoidTarget }) {
  const authProfile = useProfileStore((s) => s.authProfile)
  const actor: VoidActor | undefined =
    actorProp ?? (authProfile ? { id: authProfile.id, name: authProfile.full_name ?? authProfile.name, role: authProfile.role } : undefined)
  const delivery = target.action === "order" && target.delivery === true
  const copy = delivery ? DELIVERY_COPY : COPY[target.action]
  const reasonId = useId()

  const [step, setStep] = useState<Step>("what")
  const [lineId, setLineId] = useState<string | undefined>(
    target.action === "item" ? (target.lineId ?? (target.lines.length === 1 ? target.lines[0]!.id : undefined)) : undefined,
  )
  const [quantity, setQuantity] = useState(1)
  const [paymentId, setPaymentId] = useState<string | undefined>(
    target.action === "payment" ? (target.paymentId ?? (target.payments.length === 1 ? target.payments[0]!.id : undefined)) : undefined,
  )
  const [reason, setReason] = useState<VoidReasonCode | null>(null)
  const [reasonText, setReasonText] = useState("")
  const [supervisorId, setSupervisorId] = useState<string | null>(null)
  const [pin, setPin] = useState("")
  const [problem, setProblem] = useState<Problem | null>(null)
  const [busy, setBusy] = useState(false)
  const [doneInfo, setDoneInfo] = useState<{ authorizer: string | null; at: Date; newTotal?: number } | null>(null)

  const config = useQuery({ queryKey: CONFIG_QUERY_KEY, queryFn: fetchConfig })
  const allowSelf = config.data?.allowSelfAuthorization === true
  // The API has the last word: authorization_required on a direct cancel turns the supervisor step on.
  const [authorizationRequired, setAuthorizationRequired] = useState(false)
  // A Domicilio needs a supervisor only when it is paid (user decision, F3b).
  const needsAuthorization =
    target.action !== "order" ||
    (!delivery && target.lines.length > 0) ||
    target.hasPayments === true ||
    authorizationRequired
  const supervisors = useQuery({
    queryKey: SUPERVISORS_QUERY_KEY,
    queryFn: loadSupervisors,
    enabled: needsAuthorization,
    refetchOnMount: "always",
    retry: false,
  })
  // A paid Domicilio's payment is voided with it. pay_order leaves orders.total = bill + fee + tip,
  // the live payment's total; read it when a supervisor is needed (the board's row may be stale).
  const deliveryOrder = useQuery({
    queryKey: ["void-delivery-order", target.orderId],
    queryFn: () => getById(target.orderId),
    enabled: delivery && needsAuthorization,
    retry: false,
  })
  const paidAmount = deliveryOrder.data?.status === "paid" ? deliveryOrder.data.total : null
  const tiles = supervisorTiles(supervisors.data ?? [], actor?.id, allowSelf)
  const supervisor = tiles.find((tile) => tile.id === supervisorId) ?? null

  const line = target.action === "item" ? target.lines.find((candidate) => candidate.id === lineId) : undefined
  const payment = target.action === "payment" ? target.payments.find((candidate) => candidate.id === paymentId) : undefined
  const reasons = VOID_REASONS.filter((option) => target.action === "payment" || option.code !== "wrong_payment_method")
  const reasonLabel = reasons.find((option) => option.code === reason)?.label ?? ""
  const textError = reasonTextError(reason, reasonText)
  const cleanText = reason === "other" ? reasonText.trim().replace(/\s+/g, " ") : null

  const subject =
    target.action === "item"
      ? line && { title: `${quantity}× ${line.name}`, amount: line.price * quantity }
      : target.action === "order"
        ? { title: `${delivery ? "Domicilio" : "Orden"} ${target.label}`, amount: target.total }
        : payment && { title: payment.title, amount: payment.amount }

  const ready = canContinue({
    reason,
    reasonText,
    quantity: target.action === "item" ? quantity : 1,
    hasSubject: Boolean(subject),
  })

  const locked = problem?.kind === "locked"

  const runVoid = async (authorizationId?: string): Promise<VoidResult> => {
    const body = { reason: reason!, reasonText: cleanText, ...(authorizationId ? { authorizationId } : {}) }
    if (target.action === "item") {
      const order = await voidOrderItems(target.orderId, { items: [{ itemId: line!.id, quantity }], ...body })
      return { action: "item", orderId: target.orderId, order }
    }
    if (target.action === "order") {
      await (delivery ? cancelDelivery(target.orderId, body) : cancelOrder(target.orderId, body))
      return { action: "order", orderId: target.orderId }
    }
    await voidPayment(payment!.id, { ...body, authorizationId: authorizationId! })
    return { action: "payment", orderId: target.orderId, paymentId: payment!.id }
  }

  const finish = (result: VoidResult, authorizer: string | null) => {
    setDoneInfo({ authorizer, at: new Date(), newTotal: result.order?.total })
    setStep("done")
    onDone?.(result)
  }

  const showRefusal = (error: unknown) => {
    const refusal = voidRefusalOf(error)
    if (refusal?.code === "authorization_required") {
      setPin("")
      setAuthorizationRequired(true)
      setProblem(null)
      setStep("who")
    } else if (refusal?.code === "authorization_invalid") {
      setPin("")
      setProblem({ kind: "expired" })
      setStep("who")
    } else if (refusal?.code === "self_authorization_not_allowed") {
      setPin("")
      setProblem({ kind: "self" })
      setStep("who")
    } else {
      setProblem({ kind: "refusal", message: refusal?.message ?? "No se pudo completar. Revisa la conexión e inténtalo de nuevo." })
    }
  }

  // An order with nothing on it needs no supervisor (L15).
  const cancelWithoutAuthorization = async () => {
    if (busy) return
    setBusy(true)
    try {
      finish(await runVoid(), null)
    } catch (error) {
      showRefusal(error)
    } finally {
      setBusy(false)
    }
  }

  const authorize = async () => {
    if (!supervisor || pin.length < PIN_MIN || busy || locked) return
    setBusy(true)
    setProblem(null)
    let authorization: Awaited<ReturnType<typeof authorizeSupervisor>>
    try {
      authorization = await authorizeSupervisor({
        pin,
        action: SUPERVISOR_ACTION[target.action],
        profileId: supervisor.id,
        ...authorizationTarget(target, payment?.id),
      })
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
    try {
      finish(await runVoid(authorization.authorizationId), authorization.supervisor.name)
    } catch (error) {
      showRefusal(error)
    } finally {
      setBusy(false)
    }
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

  const header = (title: string, withSteps: boolean) => (
    <>
      <header className="flex items-start gap-3 px-5 pb-2 pt-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted-fg">
            {copy.eyebrow} · {target.label}
          </p>
          <DialogPrimitive.Title asChild>
            <h2 className="mt-0.5 text-xl font-bold text-fg">{title}</h2>
          </DialogPrimitive.Title>
        </div>
        <DialogPrimitive.Close asChild>
          <Button variant="ghost" size="icon" className="h-11 w-11 flex-none" aria-label="Cerrar">
            <X className="h-5 w-5" aria-hidden />
          </Button>
        </DialogPrimitive.Close>
      </header>
      {withSteps && <Steps current={step === "what" ? 0 : step === "who" ? 1 : 2} />}
    </>
  )

  // The paid Domicilio's payment is voided with it: say so where the supervisor decides.
  const paymentWarning = delivery && needsAuthorization && !deliveryOrder.isLoading && (
    <Alert tone="warning">
      <b>
        {paidAmount !== null
          ? `El pago de ${formatCurrency(paidAmount)} se anula: devuelve el dinero al cliente`
          : "Este domicilio ya tiene un pago; se anula al cancelar"}
      </b>
    </Alert>
  )

  const summary = subject && (
    <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm">
      <span className="min-w-0 flex-1 break-words">
        <b>{subject.title}</b> · <Money>−{formatCurrency(subject.amount)}</Money>
      </span>
      <Chip tone="reserved">{reasonLabel}</Chip>
    </div>
  )

  if (step === "done" && doneInfo) {
    return (
      <>
        {header(copy.done, false)}
        <div className="flex flex-col items-center gap-3 overflow-y-auto px-5 pb-6 pt-2 text-center">
          <span aria-hidden className="grid h-14 w-14 place-items-center rounded-full bg-status-ok-bg text-status-ok-fg">
            <Check className="h-7 w-7" />
          </span>
          {subject && (
            <p className="text-base">
              <b>{subject.title}</b> · <Money>−{formatCurrency(subject.amount)}</Money>
            </p>
          )}
          <p className="text-sm text-fg-2">
            {target.action === "item"
              ? doneInfo.newTotal !== undefined
                ? `Nuevo total de la orden: ${formatCurrency(doneInfo.newTotal)}.`
                : "La orden quedó sin ese plato."
              : target.action === "order"
                ? delivery
                  ? "El domicilio pasa a Canceladas con su motivo."
                  : "La orden pasa a Canceladas y la mesa queda libre si no tiene otra orden abierta."
                : "La orden vuelve a Por cobrar y se puede cobrar de nuevo."}
          </p>
          <dl className="grid w-full max-w-sm grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-lg border border-line p-3 text-left text-sm">
            <dt className="text-muted-fg">Motivo</dt>
            <dd className="break-words">{cleanText ? `Otro: «${cleanText}»` : reasonLabel}</dd>
            <dt className="text-muted-fg">Pidió</dt>
            <dd className="break-words">{actor?.name ?? "—"}</dd>
            <dt className="text-muted-fg">Autorizó</dt>
            <dd className="break-words">{doneInfo.authorizer ?? "No hizo falta"}</dd>
            <dt className="text-muted-fg">Hora</dt>
            <dd className="tabular-nums">{clock(doneInfo.at)}</dd>
          </dl>
          <p className="text-xs text-muted-fg">
            No se puede deshacer. Queda en el registro de anulaciones.
            {target.action !== "payment" && " El inventario no se devuelve."}
          </p>
          <Button className="h-12 w-full max-w-sm text-base" onClick={onClose}>
            {copy.back}
          </Button>
        </div>
      </>
    )
  }

  if (step === "what") {
    return (
      <>
        {header(copy.question, needsAuthorization)}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-4 pt-1">
          {target.action === "item" && (
            <>
              {target.lines.length > 1 && !target.lineId && (
                <div>
                  <p className="mb-2 text-sm font-semibold text-fg-2">Plato a anular</p>
                  <Options label="Plato a anular">
                    {target.lines.map((candidate) => (
                      <Option
                        key={candidate.id}
                        checked={candidate.id === lineId}
                        onSelect={() => {
                          setLineId(candidate.id)
                          setQuantity(1)
                        }}
                      >
                        <span className="min-w-0 flex-1 break-words font-semibold">
                          {candidate.quantity}× {candidate.name}
                          {candidate.modifiers?.length ? (
                            <small className="block text-xs font-normal text-muted-fg">
                              {candidate.modifiers.map(modifierLabel).join(", ")}
                            </small>
                          ) : null}
                        </span>
                        <Money>{formatCurrency(candidate.price * candidate.quantity)}</Money>
                      </Option>
                    ))}
                  </Options>
                </div>
              )}
              {line && (
                <>
                  {(target.lines.length === 1 || target.lineId) && (
                    <div className="flex items-baseline gap-3 rounded-lg border border-line px-3 py-2.5">
                      <span className="tabular-nums text-muted-fg">{line.quantity}×</span>
                      <span className="min-w-0 flex-1 break-words">
                        <b>{line.name}</b>
                        {line.modifiers?.length ? (
                          <span role="list" aria-label="Opciones" className="block text-xs text-fg-2">
                            {line.modifiers.map((modifier) => (
                              <span role="listitem" key={modifier.optionId} className="block">
                                {modifierLabel(modifier)}
                              </span>
                            ))}
                          </span>
                        ) : null}
                        {line.comments && <small className="block text-xs text-muted-fg">“{line.comments}”</small>}
                        <small className="block text-xs text-muted-fg">Orden {target.label} · enviado a cocina</small>
                      </span>
                      <Money>{formatCurrency(line.price * line.quantity)}</Money>
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 flex-1">
                      <b className="block">Cuántos anular</b>
                      <small className="text-xs text-muted-fg">
                        de {line.quantity} · {formatCurrency(line.price)} cada uno
                      </small>
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-pill border border-line p-1">
                      <Button variant="ghost" size="icon" className="h-11 w-11 rounded-full" aria-label="Uno menos" disabled={quantity <= 1} onClick={() => setQuantity((q) => q - 1)}>
                        <Minus className="h-4 w-4" aria-hidden />
                      </Button>
                      <b aria-live="polite" className="w-8 text-center text-lg tabular-nums">
                        {quantity}
                      </b>
                      <Button variant="ghost" size="icon" className="h-11 w-11 rounded-full" aria-label="Uno más" disabled={quantity >= line.quantity} onClick={() => setQuantity((q) => q + 1)}>
                        <Plus className="h-4 w-4" aria-hidden />
                      </Button>
                    </span>
                  </div>
                </>
              )}
              <VoidDiscountNote totalDiscounts={target.totalDiscounts ?? 0} />
            </>
          )}

          {target.action === "order" && (
            <div className="rounded-lg border border-line">
              {target.lines.map((candidate) => (
                <div key={candidate.id} className="flex items-baseline gap-3 border-b border-line px-3 py-2 text-sm last:border-0">
                  <span className="w-7 tabular-nums text-muted-fg">{candidate.quantity}×</span>
                  <b className="min-w-0 flex-1 break-words font-medium">{candidate.name}</b>
                  <Money>{formatCurrency(candidate.price * candidate.quantity)}</Money>
                </div>
              ))}
              <div className="flex items-baseline gap-3 px-3 py-2 text-sm font-bold">
                <span className="min-w-0 flex-1">
                  {delivery ? "Total del domicilio" : target.lines.length > 0 ? "Total · ya en cocina" : "Sin platos"}
                </span>
                <Money>{formatCurrency(target.total)}</Money>
              </div>
            </div>
          )}

          {target.action === "payment" && (
            <Options label="Pago a anular">
              {target.payments.map((candidate) => (
                <Option key={candidate.id} checked={candidate.id === paymentId} onSelect={() => setPaymentId(candidate.id)}>
                  <span className="min-w-0 flex-1">
                    <b className="block break-words">{candidate.title}</b>
                    {candidate.detail && <small className="text-xs text-muted-fg">{candidate.detail}</small>}
                  </span>
                  <Money>{formatCurrency(candidate.amount)}</Money>
                </Option>
              ))}
            </Options>
          )}

          <div>
            <p className="mb-2 text-sm font-semibold text-fg-2">Motivo</p>
            <Options label="Motivo">
              {reasons.map((option) => (
                <Option key={option.code} checked={reason === option.code} onSelect={() => setReason(option.code)}>
                  <b className="min-w-0 flex-1 font-medium">{option.label}</b>
                </Option>
              ))}
            </Options>
          </div>

          {reason === "other" && (
            <div>
              <label htmlFor={reasonId} className="mb-1.5 block text-sm font-semibold">
                Escribe el motivo (obligatorio)
              </label>
              <input
                id={reasonId}
                value={reasonText}
                maxLength={240}
                onChange={(event) => setReasonText(event.target.value)}
                placeholder="Ej.: el plato salió frío"
                aria-invalid={textError !== null}
                aria-describedby={textError ? `${reasonId}-error` : undefined}
                className={cn(
                  "h-12 w-full rounded-lg border bg-surface px-3 text-base text-fg",
                  textError ? "border-status-danger-line" : "border-line-strong",
                  focusRing,
                )}
              />
              {textError && (
                <p id={`${reasonId}-error`} className="mt-1.5 text-sm text-status-danger-fg">
                  {textError}
                </p>
              )}
            </div>
          )}

          <p className="text-xs text-muted-fg">{copy.note}</p>
          {problem?.kind === "refusal" && <Alert tone="danger">{problem.message}</Alert>}
        </div>
        <footer className="flex gap-2 border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button variant="outline" className="h-12 flex-1 text-base" onClick={onClose}>
            Cancelar
          </Button>
          {needsAuthorization ? (
            <Button
              className="h-12 flex-[2] text-base"
              disabled={!ready}
              onClick={() => {
                setProblem(null)
                setStep("who")
              }}
            >
              Elegir quién autoriza
            </Button>
          ) : (
            <Button variant="destructive" className="h-12 flex-[2] text-base" disabled={!ready || busy} onClick={() => void cancelWithoutAuthorization()}>
              {delivery ? "Cancelar domicilio" : "Cancelar orden"}
            </Button>
          )}
        </footer>
      </>
    )
  }

  if (step === "who") {
    const isWaiter = actor?.role === "waiter"
    return (
      <>
        {header("¿Quién autoriza?", true)}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-4 pt-1">
          {summary}
          {paymentWarning}
          {problem?.kind === "expired" && (
            <Alert tone="warning">
              <b>La autorización venció.</b> Pasaron más de 2 minutos y no se anuló nada. Elige quién autoriza y escribe el PIN otra vez.
            </Alert>
          )}
          <p className="text-sm text-fg-2">
            {isWaiter
              ? "Pide a un supervisor que autorice: entrégale el celular para que toque su nombre y escriba su PIN."
              : "Elige a la persona que autoriza. Después escribe su PIN."}
          </p>
          {supervisors.isLoading ? (
            <p className="text-sm text-muted-fg" aria-busy="true">
              Cargando quién autoriza…
            </p>
          ) : supervisors.isError ? (
            <Alert tone="danger">
              No se pudo cargar quién autoriza.{" "}
              <button type="button" className={cn("inline-flex min-h-[44px] items-center px-1 font-semibold underline", focusRing)} onClick={() => void supervisors.refetch()}>
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
                const refusedShown = tile.refused && problem?.kind === "self"
                return (
                  <Option key={tile.id} checked={false} disabled={tile.refused || !tile.hasPin} danger={refusedShown} onSelect={() => pickSupervisor(tile)}>
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
                      <Chip tone={refusedShown ? "danger" : "reserved"}>{refusedShown ? "No permitido" : "Otra persona"}</Chip>
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
              <b>Debe autorizar otra persona.</b> Tu PIN no sirve para tus propias anulaciones. El admin puede permitirlo en Configuración → Acceso de meseros.
            </Alert>
          )}
          <p className="text-xs text-muted-fg">Solo admin y cajeros con PIN pueden autorizar.</p>
        </div>
        <footer className="flex gap-2 border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button
            variant="outline"
            className="h-12 flex-1 text-base"
            onClick={() => {
              setProblem(null)
              setStep("what")
            }}
          >
            Atrás
          </Button>
        </footer>
      </>
    )
  }

  // step === "pin"
  const name = supervisor?.fullName ?? ""
  const untilLabel = problem?.kind === "locked" ? lockedUntilLabel(problem.until) : null
  return (
    <>
      {header(`${firstName(name)}, escribe tu PIN`, true)}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-4 pt-1">
        {summary}
        {paymentWarning}
        {supervisor && (
          <div className="flex items-center gap-3">
            <Avatar name={name} />
            <span className="min-w-0 flex-1">
              <b className="block break-words">{name}</b>
              <small className="text-xs text-muted-fg">{ROLE_LABEL[supervisor.role]} · escribe tu PIN</small>
            </span>
            <Button
              variant="ghost"
              className="h-11"
              onClick={() => {
                setProblem(null)
                setPin("")
                setStep("who")
              }}
            >
              Cambiar
            </Button>
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
              <b>Bloqueado hasta {untilLabel}.</b> {name} escribió 5 PIN incorrectos. Pide a otra persona que autorice o espera.
            </Alert>
          ) : (
            <Alert tone="danger">{problem.message}</Alert>
          ))}
        {problem?.kind === "refusal" && <Alert tone="danger">{problem.message}</Alert>}

        <div role="img" aria-label={`${pin.length} de 4 a 6 dígitos`} className="flex justify-center gap-3 py-1">
          {Array.from({ length: PIN_MAX }).map((_, index) => (
            <i
              key={index}
              className={cn(
                "h-3.5 w-3.5 rounded-full border-2",
                index < pin.length ? "border-fg bg-fg" : index < PIN_MIN ? "border-line-strong" : "border-dashed border-line",
                problem?.kind === "wrong" && "border-status-danger-fg",
              )}
            />
          ))}
        </div>
        <p className="text-center text-xs text-muted-fg">PIN de 4 a 6 dígitos</p>
        <PinPad
          disabled={locked || busy}
          canSubmit={pin.length >= PIN_MIN && !locked && !busy}
          busy={busy}
          onDigit={press}
          onDelete={() => setPin((current) => current.slice(0, -1))}
          onSubmit={() => void authorize()}
        />
        {locked ? (
          <Button
            className="h-12 w-full text-base"
            onClick={() => {
              setProblem(null)
              setStep("who")
            }}
          >
            Elegir otro supervisor
          </Button>
        ) : (
          <p className="text-center text-xs text-muted-fg">Al autorizar se aplica de inmediato y no se puede deshacer.</p>
        )}
      </div>
      <footer className="flex gap-2 border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button
          variant="outline"
          className="h-12 flex-1 text-base"
          onClick={() => {
            setProblem(null)
            setPin("")
            setStep("who")
          }}
        >
          Atrás
        </Button>
      </footer>
    </>
  )
}

const pad2 = (n: number) => String(n).padStart(2, "0")
const clock = (date: Date) => `${pad2(date.getHours())}:${pad2(date.getMinutes())}`

function Steps({ current }: { current: number }) {
  const labels = ["Qué y motivo", "Quién autoriza", "PIN"]
  return (
    <ol aria-label="Pasos" className="grid grid-cols-3 gap-1.5 px-5 pb-3">
      {labels.map((label, index) => {
        const done = index < current
        return (
          <li
            key={label}
            aria-current={index === current ? "step" : undefined}
            className={cn(
              "flex min-w-0 items-center gap-1.5 rounded-pill px-2 py-1 text-xs font-semibold",
              index === current ? "bg-brand-tint text-brand-strong" : done ? "text-status-ok-fg" : "text-muted-fg",
            )}
          >
            <span
              className={cn(
                "grid h-5 w-5 flex-none place-items-center rounded-full text-[11px]",
                index === current ? "bg-brand text-brand-contrast" : done ? "bg-status-ok-bg" : "bg-surface-2",
              )}
            >
              {done ? <Check className="h-3 w-3" aria-hidden /> : index + 1}
            </span>
            <span className="truncate">{label}</span>
          </li>
        )
      })}
    </ol>
  )
}
