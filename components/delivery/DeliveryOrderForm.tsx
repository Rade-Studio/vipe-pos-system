'use client'

import { useEffect, useMemo, useReducer, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2, Minus, Plus, Search, Trash2 } from 'lucide-react'
import { categoryService } from '@/lib/supabase/service'
import { dishServiceWithPromotions } from '@/lib/supabase/dish-service-with-promotions'
import {
  findCustomerByPhone,
  createDeliveryOrder,
  DeliveryServiceError,
  type DeliveryServiceErrorKind,
} from '@/lib/supabase/delivery-service'
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
import { createSingleFlight } from '@/lib/payments/single-flight'
import { toast } from '@/hooks/use-toast'

const DELIVERY_SERVICE_ERROR_TOAST: Record<DeliveryServiceErrorKind, string> = {
  'not-authorized': 'No tienes permiso para crear domicilios',
  'not-found': 'El cliente o la dirección ya no existe',
  rejected: '', // server message is shown directly
  'invalid-input': '', // server message is shown directly
  unknown: 'Ocurrió un error al crear el domicilio. Intenta de nuevo.',
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
  /** Whole COP percent (0..100). Comes from useConfigStore.taxPercentage. */
  taxPct: number
  onSubmitted: () => void
}

/**
 * Pure form component (no board rendering, no realtime). Owns:
 *   - phone lookup state (`findCustomerByPhone` on blur / Enter)
 *   - the draft reducer (`orderDraftReducer`)
 *   - menu picker (categories + dishes, search box, reuse of
 *     categoryService / dishServiceWithPromotions so promotions apply
 *     on the same shape the waiter menu shows)
 *   - submit gating via single-flight + Spanish toasts per
 *     DeliveryServiceError kind
 *
 * Does not own: the parent dialog open/close state, the board data
 * invalidation (the dialog handles it via `onSubmitted`).
 */
export function DeliveryOrderForm({ suggestedFee, taxPct, onSubmitted }: DeliveryOrderFormProps) {
  const [draft, dispatch] = useReducer(draftRef, initialOrderDraft({ suggestedFee }))
  const [phoneLookupError, setPhoneLookupError] = useState<string | null>(null)
  // One gate per form instance; the state flag only drives the button.
  const [submitGate] = useState(createSingleFlight)
  const [submitting, setSubmitting] = useState(false)
  const [search, setSearch] = useState('')

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
    queryFn: () => categoryService.getAllActive(),
    staleTime: 60_000,
  })
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const { data: dishes = [], isLoading: loadingDishes } = useQuery({
    queryKey: ['delivery-menu-dishes', selectedCategoryId],
    queryFn: () => dishServiceWithPromotions.getByCategoryWithPromotions(selectedCategoryId!),
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
    try {
      const result = await findCustomerByPhone(phone)
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
      setPhoneLookupError((err as Error).message ?? 'No se pudo consultar el cliente')
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
        await createDeliveryOrder(input)
        toast.success('Domicilio creado y enviado a cocina')
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

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* ---- Left: phone + customer + address ---- */}
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="phone">Teléfono</Label>
          <Input
            id="phone"
            inputMode="numeric"
            placeholder="300 123 4567"
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
          {phoneLookupError && (
            <p className="text-xs text-destructive">{phoneLookupError}</p>
          )}
          {issuesByField.get('phone') && (
            <p className="text-xs text-destructive">{issuesByField.get('phone')}</p>
          )}
        </div>

        {draft.lookup.kind === 'existing' ? (
          <div className="rounded-md border bg-muted/30 p-2 text-xs">
            <p className="font-medium">{draft.lookup.customer.name}</p>
            <p className="text-muted-foreground">
              {draft.lookup.addresses.length} dirección(es) guardada(s)
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            <Label htmlFor="customerName">Nombre del cliente</Label>
            <Input
              id="customerName"
              placeholder="Nombre completo"
              value={draft.customerName}
              onChange={(e) => dispatch({ type: 'setCustomerName', value: e.target.value })}
              aria-invalid={issuesByField.has('customerName')}
            />
            {issuesByField.get('customerName') && (
              <p className="text-xs text-destructive">{issuesByField.get('customerName')}</p>
            )}
          </div>
        )}

        {draft.lookup.kind === 'existing' ? (
          <AddressPicker
            addresses={draft.lookup.addresses}
            selectedId={
              draft.addressChoice.kind === 'existing' ? draft.addressChoice.addressId : null
            }
            onSelect={(id) => dispatch({ type: 'setAddressExisting', addressId: id })}
            error={issuesByField.get('address')}
          />
        ) : (
          <NewAddressFields
            choice={draft.addressChoice}
            onChange={(next) => dispatch({ type: 'setAddressNew', ...next })}
            onSaveToggle={(v) => dispatch({ type: 'setAddressSave', value: v })}
            error={issuesByField.get('address')}
          />
        )}

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="fee">Domicilio</Label>
            <Input
              id="fee"
              inputMode="numeric"
              value={String(draft.fee)}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value.replace(/\D/g, ''), 10)
                dispatch({ type: 'setFee', value: Number.isFinite(n) ? n : 0 })
              }}
            />
            <p className="text-xs text-muted-foreground">
              Sugerido: {formatMoney(suggestedFee)}
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="paymentMode">Pago</Label>
            <Select
              value={draft.paymentMode}
              onValueChange={(v) => dispatch({ type: 'setPaymentMode', value: v as 'prepaid' | 'cash_on_delivery' })}
            >
              <SelectTrigger id="paymentMode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash_on_delivery">Contra entrega</SelectItem>
                <SelectItem value="prepaid">Anticipado</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {draft.paymentMode === 'cash_on_delivery' && (
          <div className="space-y-1">
            <Label htmlFor="cashChangeFor">Lleva cambio de</Label>
            <Input
              id="cashChangeFor"
              inputMode="numeric"
              placeholder="0"
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
      </div>

      {/* ---- Right: menu + cart ---- */}
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="dishSearch">Buscar plato</Label>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="dishSearch"
              className="pl-7"
              placeholder="Buscar..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {loadingCategories
            ? Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-20 rounded-full" />
              ))
            : categories.map((c: CategoryLike) => (
                <Button
                  key={c.id}
                  size="sm"
                  variant={c.id === selectedCategoryId ? 'default' : 'outline'}
                  onClick={() => setSelectedCategoryId(c.id)}
                >
                  {c.name}
                </Button>
              ))}
        </div>

        <ScrollArea className="h-44 rounded-md border">
          <div className="grid grid-cols-1 gap-2 p-2 sm:grid-cols-2">
            {loadingDishes ? (
              Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))
            ) : visibleDishes.length === 0 ? (
              <p className="col-span-full p-4 text-sm text-muted-foreground">
                No hay platos disponibles.
              </p>
            ) : (
              visibleDishes.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onAddDish(d)}
                  className="flex flex-col items-start rounded-md border bg-card p-2 text-left text-xs hover:bg-accent"
                >
                  <span className="font-medium">{d.name}</span>
                  <span className="text-muted-foreground">{formatMoney(d.price)}</span>
                </button>
              ))
            )}
          </div>
        </ScrollArea>

        <CartPanel
          draft={draft}
          dispatch={dispatch}
          itemError={issuesByField.get('items') ?? null}
        />

        <div className="rounded-md border bg-muted/30 p-2 text-xs space-y-1">
          <Row label="Subtotal" value={formatMoney(totals.subtotal)} />
          <Row label={`Impuestos (${taxPct}%)`} value={formatMoney(totals.tax)} />
          <Row label="Domicilio" value={formatMoney(totals.fee)} />
          <Row label="Total" value={formatMoney(totals.total)} bold />
        </div>

        <Button
          type="button"
          className="w-full"
          onClick={() => void onSubmit()}
          disabled={issues.length > 0 || submitting}
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creando domicilio…
            </>
          ) : (
            'Crear domicilio'
          )}
        </Button>
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
              className={`flex w-full items-start gap-2 rounded-md border p-2 text-left text-xs hover:bg-accent ${
                a.id === selectedId ? 'border-primary bg-accent' : ''
              }`}
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
          <div className="flex items-center justify-between">
            <span className="font-medium">{line.name}</span>
            <button
              type="button"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => dispatch({ type: 'removeItem', lineId: line.id })}
              aria-label="Quitar producto"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="outline"
                className="h-6 w-6"
                onClick={() => dispatch({ type: 'decrementItem', lineId: line.id })}
              >
                <Minus className="h-3 w-3" />
              </Button>
              <span className="w-6 text-center">{line.quantity}</span>
              <Button
                size="icon"
                variant="outline"
                className="h-6 w-6"
                onClick={() => dispatch({ type: 'incrementItem', lineId: line.id })}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
            <span>{formatMoney(line.unitPrice * line.quantity)}</span>
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
    <div className={`flex items-center justify-between ${bold ? 'font-semibold' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
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

// Bind the reducer once so React's identity check stays stable
// across re-renders (recreating it on every render would force the
// whole form subtree to remount on parent re-render).
const draftRef = (state: OrderDraft, action: OrderDraftAction): OrderDraft =>
  orderDraftReducer(state, action)