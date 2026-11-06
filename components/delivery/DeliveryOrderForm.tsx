'use client'

import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import { ArrowLeft, ArrowRight, Check, Loader2, Minus, Plus, Search, Trash2 } from 'lucide-react'
import { fetchCategories, fetchDishes } from '@/lib/api/catalog'
import {
  findCustomerByPhone,
  createDeliveryOrder,
  DeliveryServiceError,
  type DeliveryServiceErrorKind,
} from '@/lib/api/delivery'
import { normalizePhone } from '@/lib/delivery/phone'
import { formatAddress } from '@/lib/delivery/address'
import {
  initialOrderDraft,
  orderDraftReducer,
  validateDraft,
  draftTotals,
  toCreateInput,
  type OrderDraft,
  type OrderDraftAction,
} from '@/lib/delivery/order-draft'
import { ORDER_STEPS, stepForField, type OrderStepId } from '@/lib/delivery/console'
import { createSingleFlight } from '@/lib/payments/single-flight'
import { FOCUS_RING, MONEY, PILL_BUTTON } from './console-ui'
import { toast } from '@/hooks/use-toast'

const DELIVERY_SERVICE_ERROR_TOAST: Record<DeliveryServiceErrorKind, string> = {
  'not-authorized': 'No tienes permiso para crear domicilios',
  'not-found': 'El cliente o la dirección ya no existe',
  rejected: '', // server message is shown directly
  'invalid-input': '', // server message is shown directly
  unknown: 'Ocurrió un error al crear el domicilio. Intenta de nuevo.',
}

/** Same wording as the inventory shortage messages (`lib/inventory/errors.ts`). */
function formatShortages(shortages: ReadonlyArray<{ name: string; unit: string; missing: number }>): string {
  return shortages.map((s) => `${s.name} (faltan ${s.missing}${s.unit ? ` ${s.unit}` : ''})`).join(', ')
}

function deliveryErrorMessage(err: unknown): string {
  if (err instanceof DeliveryServiceError) {
    const base = DELIVERY_SERVICE_ERROR_TOAST[err.kind]
    if (base) return base
    return err.message || 'La operación fue rechazada por el servidor'
  }
  return 'Ocurrió un error inesperado. Intenta de nuevo.'
}

interface DeliveryOrderFormProps {
  /** Whole COP pesos; preloaded from business_config.delivery_default_fee when present, else 0. */
  suggestedFee: number
  /**
   * False while the suggestion is still being read. The form renders anyway
   * (T10/S2: no blank panel while a request is in flight) and seeds the
   * suggestion as soon as it resolves.
   */
  suggestedFeeResolved?: boolean
  /** Whole COP percent (0..100). Comes from useConfigStore.taxPercentage. */
  taxPct: number
  onSubmitted: () => void
}

/**
 * Pure form component (no board rendering, no realtime). T12: a step layout
 * (Cliente → Dirección → Productos → Pago → Confirmar) over the same draft,
 * with a persistent summary; validation and submit are unchanged. Owns:
 *   - phone lookup state (`findCustomerByPhone` on blur / Enter)
 *   - the draft reducer (`orderDraftReducer`)
 *   - menu picker (categories + dishes, search box, reuse of
 *     the catalog API with server-side promotion pricing, the same
 *     prices the waiter menu shows)
 *   - submit gating via single-flight + Spanish toasts per
 *     DeliveryServiceError kind
 *
 * Does not own: the parent dialog open/close state, the board data
 * invalidation (the dialog handles it via `onSubmitted`).
 */
export function DeliveryOrderForm({
  suggestedFee,
  suggestedFeeResolved = true,
  taxPct,
  onSubmitted,
}: DeliveryOrderFormProps) {
  const [draft, dispatch] = useReducer(draftRef, initialOrderDraft({ suggestedFee }))
  // Once the operator types a fee, a suggestion that arrives later (or a
  // re-suggested value) must not overwrite what they typed.
  const feeTouched = useRef(false)
  const [phoneLookupError, setPhoneLookupError] = useState<string | null>(null)
  // One gate per form instance; the state flag only drives the button.
  const [submitGate] = useState(createSingleFlight)
  const [submitting, setSubmitting] = useState(false)
  // Only the latest lookup may write its result, and submit waits for it.
  const lookupSeq = useRef(0)
  const [lookupPending, setLookupPending] = useState(false)
  const [search, setSearch] = useState('')
  const [step, setStep] = useState<OrderStepId>('customer')
  const stepIndex = ORDER_STEPS.findIndex((st) => st.id === step)
  const headingRefs = useRef<Partial<Record<OrderStepId, HTMLHeadingElement | null>>>({})
  const stepMoved = useRef(false)
  const goTo = (next: OrderStepId) => {
    stepMoved.current = true
    setStep(next)
  }
  // Move focus to the new step's heading so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (!stepMoved.current) return
    headingRefs.current[step]?.focus()
  }, [step])

  const issues = useMemo(() => validateDraft(draft, taxPct), [draft, taxPct])
  const totals = useMemo(() => draftTotals(draft, taxPct), [draft, taxPct])
  const issuesByField = useMemo(() => {
    const map = new Map<string, string>()
    for (const i of issues) map.set(i.field, i.message)
    return map
  }, [issues])

  // Menu data: same categories + dishes the waiter uses (with
  // promotions). The category list loads on mount; the dish list
  // loads per category change. A search box filters dishes across
  // categories for the operator.
  const { data: categories = [], isLoading: loadingCategories } = useQuery({
    queryKey: ['delivery-menu-categories'],
    queryFn: () => fetchCategories({ active: true }),
    staleTime: 60_000,
  })
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const { data: dishes = [], isLoading: loadingDishes } = useQuery({
    queryKey: ['delivery-menu-dishes', selectedCategoryId],
    queryFn: () => fetchDishes({ categoryId: selectedCategoryId!, active: true, pricing: 'promotions' }),
    enabled: selectedCategoryId !== null,
    staleTime: 60_000,
  })

  // Pick the first category once it arrives so the dish pane has
  // something to render on first open.
  useEffect(() => {
    if (selectedCategoryId === null && categories.length > 0) {
      setSelectedCategoryId(categories[0]!.id)
    }
  }, [categories, selectedCategoryId])

  // Filter dishes by the search box across the visible category.
  const visibleDishes = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (needle.length === 0) return dishes as DishLike[]
    return (dishes as DishLike[]).filter((d) => d.name.toLowerCase().includes(needle))
  }, [dishes, search])

  // Seed the suggested fee once it is known. The dialog used to hold the form
  // back until the read resolved; now the form is already on screen and this
  // is what fills the field (T10/S2).
  useEffect(() => {
    if (!suggestedFeeResolved) return
    if (feeTouched.current) return
    if (draft.fee === suggestedFee) return
    dispatch({ type: 'setFee', value: suggestedFee })
  }, [draft.fee, suggestedFee, suggestedFeeResolved])

  const onAddDish = (dish: DishLike) => {
    const action: OrderDraftAction = {
      type: 'addItem',
      line: {
        dishId: dish.id,
        name: dish.name,
        unitPrice: dish.price,
        quantity: 1,
        comments: dish.comments ?? null,
      },
    }
    dispatch(action)
  }

  // Phone lookup: fires on blur and on Enter while the phone has the
  // minimum viable length. `setLookup({ kind: 'new', phone })` is the
  // explicit signal "we asked the registry, there is no row".
  const onPhoneLookup = async () => {
    setPhoneLookupError(null)
    const phone = draft.phoneInput.trim()
    if (phone.length === 0) return
    const normalized = normalizePhone(phone)
    if (normalized === null) {
      setPhoneLookupError('Ingresa un teléfono válido (7 a 15 dígitos)')
      return
    }
    const seq = ++lookupSeq.current
    setLookupPending(true)
    try {
      const result = await findCustomerByPhone(phone)
      if (seq !== lookupSeq.current) return
      if (result === null) {
        dispatch({ type: 'setLookup', lookup: { kind: 'new', phone: normalized } })
        return
      }
      const defaultAddr = result.addresses.find((a) => a.isDefault) ?? result.addresses[0] ?? null
      dispatch({
        type: 'setLookup',
        lookup: {
          kind: 'existing',
          customer: result.customer,
          addresses: result.addresses,
          defaultAddressId: defaultAddr?.id ?? '',
        },
      })
      // Pre-fill the address choice with the default row so the
      // operator does not have to click again. Existing customers
      // also do NOT need to re-type their name on the form.
      if (defaultAddr) {
        dispatch({ type: 'setAddressExisting', addressId: defaultAddr.id })
      }
    } catch (err) {
      // Network / RLS errors keep the form usable (operator can still
      // type a name and a new address). We surface the message in the
      // phone field rather than as a blocking dialog.
      if (seq !== lookupSeq.current) return
      dispatch({ type: 'setLookup', lookup: { kind: 'none', phone: '' } })
      setPhoneLookupError((err as Error).message ?? 'No se pudo consultar el cliente')
    } finally {
      if (seq === lookupSeq.current) setLookupPending(false)
    }
  }

  const onSubmit = async () => {
    if (issues.length > 0) {
      toast.error(issues[0]!.message)
      return
    }
    const task = submitGate.run(async () => {
      setSubmitting(true)
      try {
        const input = toCreateInput(draft)
        // One request: the server creates the order, consumes its stock and
        // enqueues the kitchen command in one transaction (T11). A shortage
        // keeps the order; any other failure rolls all three back.
        const created = await createDeliveryOrder(input)
        const shortages = created.consumption.shortages
        if (shortages.length > 0) {
          toast.warning(
            `El domicilio se creó y se envió a cocina, pero hay stock insuficiente: ${formatShortages(shortages)}.`,
          )
        } else {
          toast.success('Domicilio creado y enviado a cocina')
        }
        onSubmitted()
      } catch (err) {
        toast.error(deliveryErrorMessage(err))
      } finally {
        setSubmitting(false)
      }
    })
    if (task === null) {
      toast.warning('Ya hay un envío en curso')
      return
    }
    await task
  }

  const stepHeading = (id: OrderStepId) => (
    <h3
      ref={(el) => {
        headingRefs.current[id] = el
      }}
      tabIndex={-1}
      className="text-xl font-semibold tracking-tight focus:outline-none"
    >
      {ORDER_STEPS.find((st) => st.id === id)!.title}
    </h3>
  )
  const addressText =
    draft.addressChoice.kind === 'existing' && draft.lookup.kind === 'existing'
      ? (() => {
          const choice = draft.addressChoice
          const a = draft.lookup.addresses.find((x) => x.id === choice.addressId)
          return a ? safeFormat({ addressLine: a.addressLine, neighborhood: a.neighborhood, reference: a.reference }) : ''
        })()
      : draft.addressChoice.kind === 'new' && draft.addressChoice.addressLine.trim().length > 0
        ? safeFormat({
            addressLine: draft.addressChoice.addressLine,
            neighborhood: draft.addressChoice.neighborhood,
            reference: draft.addressChoice.reference,
          })
        : ''
  const customerText = draft.lookup.kind === 'existing' ? draft.lookup.customer.name : draft.customerName.trim()
  const itemCount = draft.cartLines.reduce((n, l) => n + l.quantity, 0)
  const stepsWithIssues = new Set(issues.map((i) => stepForField(i.field)))

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <nav aria-label="Pasos del domicilio" className="border-b border-line px-3 py-2 sm:px-5">
        <ol className="flex gap-1">
          {ORDER_STEPS.map((st, i) => {
            const current = st.id === step
            // A past step only reads as done when nothing in it is still missing.
            const done = i < stepIndex && !stepsWithIssues.has(st.id)
            return (
              <li key={st.id} className={cn('min-w-0', current ? 'flex-[1.4_1_0]' : 'flex-1')}>
                <button
                  type="button"
                  onClick={() => goTo(st.id)}
                  aria-current={current ? 'step' : undefined}
                  className={cn(
                    'flex min-h-11 w-full min-w-0 items-center justify-center gap-1.5 rounded-xl border px-1 text-[12.5px] font-semibold',
                    current ? 'border-brand-line bg-brand-tint text-fg' : 'border-transparent text-muted-fg hover:bg-surface-2',
                    done && 'text-fg-2',
                    FOCUS_RING,
                  )}
                >
                  <i
                    className={cn(
                      'grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px] not-italic',
                      current && 'border-brand bg-brand text-brand-contrast',
                      done && 'border-status-ok-line bg-status-ok-bg text-status-ok-fg',
                      !current && !done && 'border-line-strong',
                    )}
                  >
                    {i + 1}
                  </i>
                  <em className={cn('truncate not-italic', !current && 'max-sm:sr-only')}>{st.label}</em>
                </button>
              </li>
            )
          })}
        </ol>
      </nav>

      <div className="grid min-h-0 flex-1 grid-cols-1 min-[900px]:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain">
          <section hidden={step !== 'customer'} className={stepSection(step === 'customer')}>
            {stepHeading('customer')}
            <div className="space-y-1">
              <Label htmlFor="phone">Teléfono</Label>
              <Input
                id="phone"
                inputMode="numeric"
                placeholder="300 123 4567"
                className="h-11 tabular-nums"
                value={draft.phoneInput}
                onChange={(e) => dispatch({ type: 'setPhoneInput', value: e.target.value })}
                onBlur={() => void onPhoneLookup()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void onPhoneLookup()
                  }
                }}
                aria-invalid={issuesByField.has('phone') || phoneLookupError !== null}
              />
              <p className="text-xs text-muted-fg">Enter busca el cliente.</p>
              {phoneLookupError && <p className="text-xs text-destructive">{phoneLookupError}</p>}
              {issuesByField.get('phone') && (
                <p className="text-xs text-destructive">{issuesByField.get('phone')}</p>
              )}
            </div>

            {draft.lookup.kind === 'existing' ? (
              <div className="rounded-card border border-status-ok-line bg-status-ok-bg p-3 text-sm text-status-ok-fg">
                <p className="flex items-center gap-1.5 font-medium">
                  <Check className="h-4 w-4 shrink-0" aria-hidden />
                  {draft.lookup.customer.name}
                </p>
                <p className="text-xs">{draft.lookup.addresses.length} dirección(es) guardada(s)</p>
              </div>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="customerName">Nombre del cliente</Label>
                <Input
                  id="customerName"
                  placeholder="Nombre completo"
                  className="h-11"
                  value={draft.customerName}
                  onChange={(e) => dispatch({ type: 'setCustomerName', value: e.target.value })}
                  aria-invalid={issuesByField.has('customerName')}
                />
                {issuesByField.get('customerName') && (
                  <p className="text-xs text-destructive">{issuesByField.get('customerName')}</p>
                )}
              </div>
            )}
          </section>

          <section hidden={step !== 'address'} className={stepSection(step === 'address')}>
            {stepHeading('address')}
            {draft.lookup.kind === 'existing' && draft.lookup.addresses.length > 0 && (
              <AddressPicker
                addresses={draft.lookup.addresses}
                selectedId={draft.addressChoice.kind === 'existing' ? draft.addressChoice.addressId : null}
                onSelect={(id) => dispatch({ type: 'setAddressExisting', addressId: id })}
                error={draft.addressChoice.kind === 'new' ? undefined : issuesByField.get('address')}
              />
            )}
            {draft.lookup.kind === 'existing' &&
              draft.lookup.addresses.length > 0 &&
              draft.addressChoice.kind !== 'new' && (
                <Button
                  type="button"
                  variant="outline"
                  className={cn(PILL_BUTTON, 'justify-self-start')}
                  onClick={() =>
                    dispatch({ type: 'setAddressNew', addressLine: '', neighborhood: null, reference: null, label: null })
                  }
                >
                  <Plus className="mr-1 h-4 w-4" aria-hidden />
                  Otra dirección
                </Button>
              )}
            {(draft.lookup.kind !== 'existing' ||
              draft.lookup.addresses.length === 0 ||
              draft.addressChoice.kind === 'new') && (
              <NewAddressFields
                choice={draft.addressChoice}
                onChange={(next) => dispatch({ type: 'setAddressNew', ...next })}
                onSaveToggle={(v) => dispatch({ type: 'setAddressSave', value: v })}
                error={issuesByField.get('address')}
              />
            )}
          </section>

          {/* T11 replaces this picker with the shared Categoría → Subcategoría → Plato steps. */}
          <section hidden={step !== 'products'} className={stepSection(step === 'products')}>
            {stepHeading('products')}
            <div className="space-y-1">
              <Label htmlFor="dishSearch">Buscar plato</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-fg" aria-hidden />
                <Input
                  id="dishSearch"
                  className="h-11 pl-9"
                  placeholder="Buscar..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="flex min-w-0 gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
              {loadingCategories
                ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-11 w-24 shrink-0 rounded-full" />)
                : categories.map((c: CategoryLike) => (
                    <Button
                      key={c.id}
                      variant={c.id === selectedCategoryId ? 'default' : 'outline'}
                      className={cn(PILL_BUTTON, 'shrink-0')}
                      aria-pressed={c.id === selectedCategoryId}
                      onClick={() => setSelectedCategoryId(c.id)}
                    >
                      {c.name}
                    </Button>
                  ))}
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {loadingDishes ? (
                Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-card" />)
              ) : visibleDishes.length === 0 ? (
                <p className="col-span-full p-4 text-sm text-muted-fg">No hay platos disponibles.</p>
              ) : (
                visibleDishes.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => onAddDish(d)}
                    className={cn(
                      'flex min-h-16 min-w-0 flex-col items-start justify-center gap-0.5 rounded-card border border-line bg-surface p-3 text-left text-sm hover:border-brand-line dark:bg-surface-2',
                      FOCUS_RING,
                    )}
                  >
                    <span className="line-clamp-2 font-medium [overflow-wrap:anywhere]">{d.name}</span>
                    <span className={cn(MONEY, 'text-muted-fg')}>{formatMoney(d.price)}</span>
                  </button>
                ))
              )}
            </div>

            <CartPanel draft={draft} dispatch={dispatch} itemError={issuesByField.get('items') ?? null} />
          </section>

          <section hidden={step !== 'payment'} className={stepSection(step === 'payment')}>
            {stepHeading('payment')}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <p id="paymentMode-label" className="text-sm font-medium leading-none">
                  Pago
                </p>
                <div
                  role="radiogroup"
                  aria-labelledby="paymentMode-label"
                  className="grid grid-cols-2 gap-1 rounded-pill border border-line bg-surface-2 p-1"
                >
                  {PAYMENT_MODES.map((mode) => {
                    const checked = draft.paymentMode === mode.value
                    return (
                      <button
                        key={mode.value}
                        type="button"
                        role="radio"
                        aria-checked={checked}
                        onClick={() => dispatch({ type: 'setPaymentMode', value: mode.value })}
                        className={cn(
                          'min-h-10 min-w-0 truncate rounded-pill px-3 text-sm font-medium',
                          checked ? 'bg-surface text-fg shadow-sm ring-1 ring-line-strong dark:bg-surface-2' : 'text-fg-2',
                          FOCUS_RING,
                        )}
                      >
                        {mode.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="fee">Domicilio</Label>
                <Input
                  id="fee"
                  inputMode="numeric"
                  className="h-11 tabular-nums"
                  value={String(draft.fee)}
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value.replace(/\D/g, ''), 10)
                    feeTouched.current = true
                    dispatch({ type: 'setFee', value: Number.isFinite(n) ? n : 0 })
                  }}
                />
                <p className="text-xs text-muted-fg">
                  Sugerido: <span className={MONEY}>{formatMoney(suggestedFee)}</span>
                </p>
              </div>
            </div>

            {draft.paymentMode === 'cash_on_delivery' && (
              <div className="space-y-1 sm:max-w-[50%]">
                <Label htmlFor="cashChangeFor">Lleva cambio de</Label>
                <Input
                  id="cashChangeFor"
                  inputMode="numeric"
                  placeholder="0"
                  className="h-11 tabular-nums"
                  value={draft.cashChangeFor !== null ? String(draft.cashChangeFor) : ''}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/\D/g, '')
                    if (raw === '') {
                      dispatch({ type: 'setCashChangeFor', value: null })
                      return
                    }
                    const n = Number.parseInt(raw, 10)
                    dispatch({ type: 'setCashChangeFor', value: Number.isFinite(n) ? n : 0 })
                  }}
                  aria-invalid={issuesByField.has('cashChangeFor')}
                />
                {issuesByField.get('cashChangeFor') && (
                  <p className="text-xs text-destructive">{issuesByField.get('cashChangeFor')}</p>
                )}
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="notes">Notas</Label>
              <Textarea
                id="notes"
                rows={2}
                placeholder="Tocar el timbre 2 veces..."
                value={draft.notes ?? ''}
                onChange={(e) =>
                  dispatch({ type: 'setNotes', value: e.target.value.length === 0 ? null : e.target.value })
                }
              />
            </div>
          </section>

          <section hidden={step !== 'confirm'} className={stepSection(step === 'confirm')}>
            {stepHeading('confirm')}
            <dl className="grid gap-3 text-sm">
              <ConfirmRow label="Cliente" value={customerText || 'Sin nombre'} />
              <ConfirmRow label="Dirección" value={addressText || 'Sin dirección'} />
              <ConfirmRow
                label="Pago"
                value={
                  draft.paymentMode === 'prepaid'
                    ? 'Anticipado'
                    : `Contra entrega${draft.cashChangeFor ? ` · lleva cambio de ${formatMoney(draft.cashChangeFor)}` : ''}`
                }
              />
              {draft.notes && <ConfirmRow label="Notas" value={draft.notes} />}
            </dl>
            {issues.length > 0 && (
              <div className="grid gap-2 rounded-card border border-status-warning-line bg-status-warning-bg p-3 text-status-warning-fg">
                <p className="text-sm font-medium">Falta completar:</p>
                <ul className="grid gap-1">
                  {issues.map((issue) => (
                    <li key={`${issue.field}-${issue.message}`}>
                      <button
                        type="button"
                        className={cn('min-h-11 text-left text-sm underline underline-offset-2', FOCUS_RING)}
                        onClick={() => goTo(stepForField(issue.field))}
                      >
                        {issue.message}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs text-muted-fg">El servidor recalcula los precios al crear el pedido.</p>
          </section>
        </div>

        <aside
          aria-label="Resumen del pedido"
          className="hidden min-h-0 flex-col gap-3 overflow-y-auto border-l border-line bg-surface p-5 dark:bg-surface-2 min-[900px]:flex"
        >
          <h3 className="text-base font-semibold">Resumen</h3>
          <p className="text-sm text-muted-fg [overflow-wrap:anywhere]">
            {customerText || 'Cliente sin capturar'}
            {addressText ? ` · ${addressText}` : ''}
          </p>
          {draft.cartLines.length === 0 ? (
            <p className="text-sm text-muted-fg">Sin productos todavía.</p>
          ) : (
            <ul className="grid gap-2">
              {draft.cartLines.map((line) => (
                <li key={line.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 text-sm">
                  <span className="font-semibold tabular-nums text-muted-fg">{line.quantity}×</span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">{line.name}</span>
                  <span className={MONEY}>{formatMoney(line.unitPrice * line.quantity)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-auto grid gap-1.5 border-t border-line pt-3 text-sm text-fg-2">
            <Row label="Subtotal" value={formatMoney(totals.subtotal)} />
            <Row label={`Impuestos (${taxPct}%)`} value={formatMoney(totals.tax)} />
            <Row label="Domicilio" value={formatMoney(totals.fee)} />
            <Row label="Total" value={formatMoney(totals.total)} bold />
          </div>
        </aside>
      </div>

      <div className="flex items-center gap-2 border-t border-line px-4 py-3 md:px-6">
        <Button
          type="button"
          variant="outline"
          className={cn(PILL_BUTTON, 'max-sm:w-11 max-sm:px-0')}
          onClick={() => goTo(ORDER_STEPS[stepIndex - 1]!.id)}
          disabled={stepIndex === 0}
        >
          <ArrowLeft className="h-4 w-4 sm:mr-1" aria-hidden />
          <span className="max-sm:sr-only">Atrás</span>
        </Button>
        <p className="mr-auto flex min-w-0 items-baseline gap-1.5 pl-1 text-sm text-muted-fg min-[900px]:hidden">
          <span className="truncate">
            <span className="max-sm:hidden">
              {itemCount} {itemCount === 1 ? 'producto' : 'productos'} ·{' '}
            </span>
            Total
          </span>
          <span className={cn(MONEY, 'shrink-0 font-semibold text-fg')}>{formatMoney(totals.total)}</span>
        </p>
        <span className="hidden flex-1 min-[900px]:block" />
        {step === 'confirm' ? (
          <Button
            type="button"
            className={cn(PILL_BUTTON, 'bg-btn px-5 text-btn-foreground shadow-glow hover:bg-btn/90')}
            onClick={() => void onSubmit()}
            disabled={issues.length > 0 || submitting || lookupPending}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />
                Creando domicilio…
              </>
            ) : (
              'Crear domicilio'
            )}
          </Button>
        ) : (
          <Button
            type="button"
            className={cn(PILL_BUTTON, 'bg-btn px-5 text-btn-foreground hover:bg-btn/90')}
            onClick={() => goTo(ORDER_STEPS[stepIndex + 1]!.id)}
          >
            Continuar
            <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>
    </div>
  )
}

// -----------------------------------------------------------
// Subcomponents (kept in this file because they are form-internal)
// -----------------------------------------------------------

interface DishLike {
  id: string
  name: string
  price: number
  comments?: string | null
}

interface CategoryLike {
  id: string
  name: string
}

function AddressPicker({
  addresses,
  selectedId,
  onSelect,
  error,
}: {
  addresses: ReadonlyArray<{ id: string; addressLine: string; neighborhood: string | null; reference: string | null; label: string | null }>
  selectedId: string | null
  onSelect: (id: string) => void
  error: string | undefined
}) {
  return (
    <div className="space-y-1">
      <Label>Dirección guardada</Label>
      <div className="space-y-1">
        {addresses.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            El cliente no tiene direcciones guardadas. Captura una nueva.
          </p>
        ) : (
          addresses.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onSelect(a.id)}
              className={cn(
                'flex min-h-14 w-full items-start gap-2 rounded-card border p-3 text-left text-sm',
                a.id === selectedId ? 'border-brand-line bg-brand-tint' : 'border-line hover:bg-surface-2',
                FOCUS_RING,
              )}
            >
              <Badge variant={a.id === selectedId ? 'default' : 'outline'} className="text-[10px]">
                {a.label ?? (a.id === selectedId ? 'seleccionada' : 'elegir')}
              </Badge>
              <span className="line-clamp-2">
                {safeFormat({
                  addressLine: a.addressLine,
                  neighborhood: a.neighborhood,
                  reference: a.reference,
                })}
              </span>
            </button>
          ))
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

function NewAddressFields({
  choice,
  onChange,
  onSaveToggle,
  error,
}: {
  choice: OrderDraft['addressChoice']
  onChange: (next: { addressLine: string; neighborhood: string | null; reference: string | null; label: string | null }) => void
  onSaveToggle: (value: boolean) => void
  error: string | undefined
}) {
  const get = <K extends 'addressLine' | 'neighborhood' | 'reference' | 'label'>(k: K): string =>
    choice.kind === 'new' && choice[k] !== null ? (choice[k] as string) : ''
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label htmlFor="addressLine">Dirección</Label>
        <Input
          id="addressLine"
          placeholder="Calle 5 # 10-20"
          value={get('addressLine')}
          onChange={(e) =>
            onChange({
              addressLine: e.target.value,
              neighborhood: choice.kind === 'new' ? choice.neighborhood : null,
              reference: choice.kind === 'new' ? choice.reference : null,
              label: choice.kind === 'new' ? choice.label : null,
            })
          }
          aria-invalid={Boolean(error)}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input
          placeholder="Barrio"
          value={get('neighborhood')}
          onChange={(e) =>
            onChange({
              addressLine: choice.kind === 'new' ? choice.addressLine : '',
              neighborhood: e.target.value.length === 0 ? null : e.target.value,
              reference: choice.kind === 'new' ? choice.reference : null,
              label: choice.kind === 'new' ? choice.label : null,
            })
          }
        />
        <Input
          placeholder="Referencia"
          value={get('reference')}
          onChange={(e) =>
            onChange({
              addressLine: choice.kind === 'new' ? choice.addressLine : '',
              neighborhood: choice.kind === 'new' ? choice.neighborhood : null,
              reference: e.target.value.length === 0 ? null : e.target.value,
              label: choice.kind === 'new' ? choice.label : null,
            })
          }
        />
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="saveAddress"
          checked={choice.kind === 'new' ? choice.save : false}
          onCheckedChange={(v) => onSaveToggle(v === true)}
        />
        <Label htmlFor="saveAddress" className="text-xs">
          Guardar dirección para el cliente
        </Label>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

function CartPanel({
  draft,
  dispatch,
  itemError,
}: {
  draft: OrderDraft
  dispatch: (action: OrderDraftAction) => void
  itemError: string | null
}) {
  if (draft.cartLines.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
        Toca un plato para agregarlo al pedido
        {itemError && <p className="mt-1 text-destructive">{itemError}</p>}
      </div>
    )
  }
  return (
    <div className="space-y-2 rounded-md border p-2">
      {draft.cartLines.map((line) => (
        <div key={line.id} className="space-y-1 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{line.name}</span>
            <button
              type="button"
              className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-destructive', FOCUS_RING)}
              onClick={() => dispatch({ type: 'removeItem', lineId: line.id })}
              aria-label="Quitar producto"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="outline"
                className={cn('h-11 w-11 rounded-full', FOCUS_RING)}
                aria-label={`Quitar uno de ${line.name}`}
                onClick={() => dispatch({ type: 'decrementItem', lineId: line.id })}
              >
                <Minus className="h-3 w-3" />
              </Button>
              <span className="w-8 text-center tabular-nums">{line.quantity}</span>
              <Button
                size="icon"
                variant="outline"
                className={cn('h-11 w-11 rounded-full', FOCUS_RING)}
                aria-label={`Agregar uno de ${line.name}`}
                onClick={() => dispatch({ type: 'incrementItem', lineId: line.id })}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
            <span className={MONEY}>{formatMoney(line.unitPrice * line.quantity)}</span>
          </div>
          <Input
            placeholder="Comentario"
            value={line.comments ?? ''}
            onChange={(e) =>
              dispatch({
                type: 'setItemComments',
                lineId: line.id,
                comments: e.target.value.length === 0 ? null : e.target.value,
              })
            }
          />
        </div>
      ))}
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3', bold && 'text-lg font-semibold text-fg')}>
      <span>{label}</span>
      <span className={MONEY}>{value}</span>
    </div>
  )
}

/** `hidden` alone loses to `display: grid`, so a hidden step also gets the `hidden` class. */
function stepSection(visible: boolean): string {
  return cn('grid content-start gap-4 p-4 md:px-6 md:py-5', !visible && 'hidden')
}

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-fg">{label}</dt>
      <dd className="[overflow-wrap:anywhere]">{value}</dd>
    </div>
  )
}

function safeFormat(input: { addressLine: string; neighborhood: string | null; reference: string | null }): string {
  try {
    return formatAddress(input)
  } catch {
    return input.addressLine
  }
}

function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n)
}

const PAYMENT_MODES: ReadonlyArray<{ value: 'cash_on_delivery' | 'prepaid'; label: string }> = [
  { value: 'cash_on_delivery', label: 'Contra entrega' },
  { value: 'prepaid', label: 'Anticipado' },
]

// Bind the reducer once so React's identity check stays stable
// across re-renders (recreating it on every render would force the
// whole form subtree to remount on parent re-render).
const draftRef = (state: OrderDraft, action: OrderDraftAction): OrderDraft =>
  orderDraftReducer(state, action)