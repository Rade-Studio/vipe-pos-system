"use client"

import { useEffect, useId, useMemo, useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { Loader2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
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
import { cn } from "@/lib/utils"
import { log } from "@/lib/log"
import {
  createPromotion,
  deletePromotion,
  updatePromotion,
  type CategoryDto,
  type DishDto,
  type PromotionDto,
  type PromotionKind,
  type PromotionMode,
  type PromotionTargetsDto,
} from "@/lib/api/catalog"
import type { SubcategoryDto } from "@/lib/api/subcategories"
import { ADMIN_LIST_STALE_MS, catalogKeys, fetchCategories, fetchDishes, fetchSubcategories } from "@/lib/admin/catalog"
import { ItemPicker, type PickOption } from "./ItemPicker"
import { StatePill } from "./PromotionPills"
import {
  CHANNELS,
  apiFieldErrors,
  billPreview,
  checkDraft,
  competingPromotions,
  draftBody,
  draftFromPromotion,
  draftScheduleSentence,
  draftSentence,
  emptyDraft,
  formatPesos,
  localDay,
  statePill,
  type FieldErrors,
  type PromotionDraft,
} from "./promotion-model"

/**
 * promociones T6 (S10) — the promotion editor of the 02 artboard, as a side
 * panel (a full-screen sheet on a phone): "¿Qué beneficio da?", "¿Sobre qué
 * productos?", "¿Cuándo?", "¿Dónde y con qué límites?", the live "Así
 * funcionará" with a bill preview and the competing-promotion note. A failed
 * save keeps every field; the API's 422 codes show in Spanish next to theirs.
 */

interface PromotionFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null: a new promotion. */
  promotion: PromotionDto | null
  /** Every promotion, for the competing-promotion note. */
  promotions: readonly PromotionDto[]
  /** After "Crear promoción" or "Guardar cambios"; `created` is true for a new one. */
  onSaved: (promotion: PromotionDto, created: boolean) => void
  /** After Pausar or Reactivar; the editor stays open with its edits. */
  onChanged: (promotion: PromotionDto) => void
  onDeleted: (promotion: PromotionDto) => void
}

const KINDS: { value: PromotionKind; icon: string; title: string; hint: string }[] = [
  { value: "product_discount", icon: "%", title: "Descuento en productos", hint: "% o valor fijo" },
  { value: "buy_x_pay_y", icon: "2×1", title: "Lleva N, paga M", hint: "2x1, 3x2, 2.ª al 50%" },
  { value: "combo", icon: "▣", title: "Combo a precio fijo", hint: "Elige 1 de cada grupo" },
  { value: "bill_discount", icon: "Σ", title: "Descuento a la cuenta", hint: "Con mínimo y tope" },
]
const MODES: { value: PromotionMode; label: string }[] = [
  { value: "automatic", label: "Automática" },
  { value: "manual", label: "Manual · la caja la elige" },
  { value: "manual_pin", label: "Manual con PIN de administrador" },
]
const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]
const MAX_USES = ["1", "2", "3", "5", "10"]
const MAX_GROUPS = 6
const MAX_WINDOWS = 6

const platos = (n: number) => `${n} ${n === 1 ? "plato" : "platos"}`
const selectClass =
  "flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
const toggleClass =
  "min-h-11 min-w-11 rounded-md border px-3 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-primary/50 aria-pressed:bg-primary/10 aria-pressed:text-primary"

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="grid h-6 w-6 place-items-center rounded-full border border-primary/50 bg-primary/10 text-xs font-semibold text-primary"
        >
          {n}
        </span>
        <h3 id={id} className="text-sm font-semibold">
          {title}
        </h3>
      </div>
      {children}
    </section>
  )
}

const TARGET_LISTS = { category: "categoryIds", subcategory: "subcategoryIds", dish: "dishIds" } as const
type TargetKind = keyof typeof TARGET_LISTS

const targetKeys = (t: PromotionTargetsDto) => [
  ...t.categoryIds.map((id) => `category:${id}`),
  ...t.subcategoryIds.map((id) => `subcategory:${id}`),
  ...t.dishIds.map((id) => `dish:${id}`),
]

function targetOptions(categories: readonly CategoryDto[], subcategories: readonly SubcategoryDto[], dishes: readonly DishDto[]): PickOption[] {
  return [
    ...categories.map((c) => ({
      key: `category:${c.id}`,
      name: c.name,
      kind: "Categoría",
      detail: platos(dishes.filter((d) => d.categoryId === c.id).length),
    })),
    ...subcategories.map((s) => ({
      key: `subcategory:${s.id}`,
      name: s.name,
      kind: "Subcategoría",
      detail: platos(dishes.filter((d) => d.subcategoryId === s.id).length),
    })),
    ...dishes.map((d) => ({ key: `dish:${d.id}`, name: d.name, kind: "Plato", detail: formatPesos(d.price) })),
  ]
}

export function PromotionForm({ open, onOpenChange, promotion, promotions, onSaved, onChanged, onDeleted }: PromotionFormProps) {
  const baseId = useId()
  const [draft, setDraft] = useState<PromotionDraft>(() => (promotion ? draftFromPromotion(promotion) : emptyDraft(localDay(new Date()))))
  const [current, setCurrent] = useState<PromotionDto | null>(promotion)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [busy, setBusy] = useState<"save" | "toggle" | "delete" | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // A new target (another row, "+ Nueva promoción") or a reopen starts from it;
  // a pause of the same promotion keeps the edits.
  useEffect(() => {
    if (!open) return
    setDraft(promotion ? draftFromPromotion(promotion) : emptyDraft(localDay(new Date())))
    setCurrent(promotion)
    setErrors({})
  }, [open, promotion?.id])

  const { data: categories = [] } = useQuery<CategoryDto[]>({
    queryKey: catalogKeys.categories,
    queryFn: fetchCategories,
    staleTime: ADMIN_LIST_STALE_MS,
  })
  const { data: subcategories = [] } = useQuery<SubcategoryDto[]>({
    queryKey: catalogKeys.subcategories,
    queryFn: fetchSubcategories,
    staleTime: ADMIN_LIST_STALE_MS,
  })
  const { data: dishes = [] } = useQuery<DishDto[]>({
    queryKey: catalogKeys.dishes,
    queryFn: fetchDishes,
    staleTime: ADMIN_LIST_STALE_MS,
  })
  const menu = useMemo(() => ({ categories, subcategories, dishes }), [categories, subcategories, dishes])
  const options = useMemo(() => targetOptions(categories, subcategories, dishes), [categories, subcategories, dishes])
  const dishOptions = useMemo(
    () => dishes.map((d) => ({ key: d.id, name: d.name, kind: "Plato", detail: formatPesos(d.price) })),
    [dishes],
  )

  const set = <K extends keyof PromotionDraft>(key: K, value: PromotionDraft[K]) => setDraft((d) => ({ ...d, [key]: value }))
  const errorId = (key: string) => `${baseId}-error-${key.replace(".", "-")}`
  const invalid = (key: string) =>
    errors[key] ? { "aria-invalid": true as const, "aria-describedby": errorId(key) } : { "aria-invalid": false as const }
  const fieldError = (key: string) =>
    errors[key] ? (
      <p id={errorId(key)} className="text-sm text-destructive">
        {errors[key]}
      </p>
    ) : null

  const sentence = draftSentence(draft, menu)
  const schedule = draftScheduleSentence(draft)
  const preview = billPreview(draft, menu)
  const competing = competingPromotions(draft, promotion?.id ?? null, promotions, dishes)
  const title = draft.name.trim() || "Promoción sin nombre"

  const changeTargets = (key: string, add: boolean) => {
    const [kind, id] = key.split(":") as [TargetKind, string]
    const list = TARGET_LISTS[kind]
    setDraft((d) => {
      const ids = d.targets[list].filter((x) => x !== id)
      return { ...d, targets: { ...d.targets, [list]: add ? [...ids, id] : ids } }
    })
  }
  const changeGroup = (index: number, change: Partial<PromotionDraft["comboGroups"][number]>) =>
    setDraft((d) => ({ ...d, comboGroups: d.comboGroups.map((g, i) => (i === index ? { ...g, ...change } : g)) }))
  const changeWindow = (index: number, change: Partial<PromotionDraft["windows"][number]>) =>
    setDraft((d) => ({ ...d, windows: d.windows.map((w, i) => (i === index ? { ...w, ...change } : w)) }))
  const toggleDay = (day: number) =>
    setDraft((d) => ({ ...d, days: d.days.includes(day) ? d.days.filter((x) => x !== day) : [...d.days, day].sort((a, b) => a - b) }))
  const toggleChannel = (channel: (typeof CHANNELS)[number]["value"]) =>
    setDraft((d) => ({ ...d, channels: d.channels.includes(channel) ? d.channels.filter((c) => c !== channel) : [...d.channels, channel] }))

  const failure = (error: unknown, what: string): FieldErrors =>
    apiFieldErrors(error) ?? { form: `${what}: ${error instanceof Error ? error.message : String(error)}` }

  const save = async () => {
    const found = checkDraft(draft)
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy("save")
    try {
      const saved = promotion ? await updatePromotion(promotion.id, draftBody(draft, promotion)) : await createPromotion(draftBody(draft))
      onSaved(saved, !promotion)
    } catch (error) {
      log.error("Error saving promotion:", { error: String(error) })
      setErrors(failure(error, "No se pudo guardar la promoción"))
    } finally {
      setBusy(null)
    }
  }

  const toggleActive = async () => {
    if (!current) return
    const active = !current.active
    setBusy("toggle")
    try {
      // The generated contract asks for kind, mode and restDiscountPercent on every PATCH (Log L19): the stored ones.
      const saved = await updatePromotion(current.id, {
        kind: current.kind,
        mode: current.mode,
        restDiscountPercent: current.restDiscountPercent,
        active,
      })
      setCurrent(saved)
      set("active", active)
      setErrors((e) => Object.fromEntries(Object.entries(e).filter(([key]) => key !== "form")))
      onChanged(saved)
    } catch (error) {
      log.error("Error pausing promotion:", { error: String(error) })
      setErrors((e) => ({ ...e, ...failure(error, active ? "No se pudo reactivar" : "No se pudo pausar") }))
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!promotion) return
    setBusy("delete")
    try {
      await deletePromotion(promotion.id)
      setConfirmDelete(false)
      onDeleted(promotion)
    } catch (error) {
      log.error("Error deleting promotion:", { error: String(error) })
      setConfirmDelete(false)
      setErrors((e) => ({ ...e, form: `No se pudo eliminar la promoción: ${error instanceof Error ? error.message : String(error)}` }))
    } finally {
      setBusy(null)
    }
  }

  const pill = current ? (current.active ? statePill(current, new Date()) : { label: "Pausada", tone: "paused" as const }) : null
  const restOptions = [100, 50, ...(draft.restDiscountPercent !== 100 && draft.restDiscountPercent !== 50 ? [draft.restDiscountPercent] : [])]
  const usesOptions = draft.maxUses && !MAX_USES.includes(draft.maxUses) ? [...MAX_USES, draft.maxUses] : MAX_USES
  const discountField = draft.kind === "bill_discount" ? "Descuento" : "Valor"

  const discountTypeToggle = (
    <div className="grid gap-1.5">
      <span id={`${baseId}-type`} className="text-sm font-medium">
        Tipo
      </span>
      <div role="group" aria-labelledby={`${baseId}-type`} className="inline-grid grid-flow-col overflow-hidden rounded-md border">
        {(
          [
            ["percentage", "Porcentaje"],
            ["fixed_amount", "Valor fijo"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={draft.discountType === value}
            onClick={() => set("discountType", value)}
            className="min-h-11 px-3 text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:bg-primary/10 aria-pressed:font-medium aria-pressed:text-primary [&+button]:border-l"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )

  const discountValueInput = (
    <div className="grid gap-1.5">
      <label htmlFor={`${baseId}-value`} className="text-sm font-medium">
        {discountField}
      </label>
      <Input
        id={`${baseId}-value`}
        type="number"
        inputMode="decimal"
        min={0}
        max={draft.discountType === "percentage" ? 100 : undefined}
        placeholder={draft.discountType === "percentage" ? "20" : "3000"}
        value={draft.discountValue}
        onChange={(e) => set("discountValue", e.target.value)}
        className="h-11 tabular-nums"
        {...invalid("discountValue")}
      />
      <p className="text-xs text-muted-foreground">{draft.discountType === "percentage" ? "En %" : "En pesos, por unidad"}</p>
      {fieldError("discountValue")}
    </div>
  )

  const numberField = (key: keyof PromotionDraft & string, label: string, help?: string, placeholder?: string) => (
    <div className="grid gap-1.5">
      <label htmlFor={`${baseId}-${key}`} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={`${baseId}-${key}`}
        type="number"
        inputMode="numeric"
        min={0}
        placeholder={placeholder}
        value={draft[key] as string}
        onChange={(e) => set(key, e.target.value as never)}
        className="h-11 tabular-nums"
        {...invalid(key)}
      />
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
      {fieldError(key)}
    </div>
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          "flex h-dvh w-full flex-col gap-0 p-0 sm:max-w-[520px]",
          // Cancelar closes; the stock English "Close" corner button is hidden.
          "[&>button.absolute]:hidden",
        )}
      >
        <SheetHeader className="flex-row items-start justify-between gap-3 space-y-0 border-b px-5 py-4 text-left">
          <div className="min-w-0">
            <SheetDescription className="text-xs">{promotion ? "Editar promoción" : "Nueva promoción"}</SheetDescription>
            <SheetTitle className="break-words text-lg">{title}</SheetTitle>
          </div>
          {pill && <StatePill label={pill.label} tone={pill.tone} />}
        </SheetHeader>

        <form
          noValidate
          className="grid flex-1 content-start gap-6 overflow-y-auto px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div className="grid gap-1.5">
            <label htmlFor={`${baseId}-name`} className="text-sm font-medium">
              Nombre (lo ven el mesero, la caja y el cliente)
            </label>
            <Input
              id={`${baseId}-name`}
              value={draft.name}
              maxLength={255}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Happy hour 2x1 en cócteles"
              className="h-11"
              {...invalid("name")}
            />
            {fieldError("name")}
          </div>

          <fieldset className="grid gap-3">
            <legend className="mb-3 flex items-center gap-2.5 text-sm font-semibold">
              <span
                aria-hidden
                className="grid h-6 w-6 place-items-center rounded-full border border-primary/50 bg-primary/10 text-xs font-semibold text-primary"
              >
                1
              </span>
              ¿Qué beneficio da?
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {KINDS.map((kind) => (
                <label key={kind.value} className="relative cursor-pointer">
                  <input
                    type="radio"
                    name={`${baseId}-kind`}
                    value={kind.value}
                    checked={draft.kind === kind.value}
                    onChange={() => set("kind", kind.value)}
                    className="peer sr-only"
                  />
                  <span className="grid min-h-16 grid-cols-[32px_1fr] items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 peer-checked:border-primary/50 peer-checked:bg-primary/10 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2">
                    <span aria-hidden className="grid h-8 w-8 place-items-center rounded-md border bg-background text-xs font-bold">
                      {kind.icon}
                    </span>
                    <span>
                      <b className="block text-sm font-semibold">{kind.title}</b>
                      <small className="text-xs text-muted-foreground">{kind.hint}</small>
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <Step n={2} title="¿Sobre qué productos?">
            {draft.kind === "product_discount" && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  {discountTypeToggle}
                  {discountValueInput}
                </div>
                <ItemPicker
                  label="Aplica a"
                  options={options}
                  picked={targetKeys(draft.targets)}
                  onAdd={(key) => changeTargets(key, true)}
                  onRemove={(key) => changeTargets(key, false)}
                  placeholder="Productos, categorías o subcategorías"
                  error={errors.targets}
                  errorId={errorId("targets")}
                />
              </>
            )}

            {draft.kind === "buy_x_pay_y" && (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  {numberField("buyQuantity", "Lleva")}
                  {numberField("payQuantity", "Paga")}
                  <div className="grid content-start gap-1.5">
                    <label htmlFor={`${baseId}-rest`} className="text-sm font-medium">
                      Las demás
                    </label>
                    <select
                      id={`${baseId}-rest`}
                      value={String(draft.restDiscountPercent)}
                      onChange={(e) => set("restDiscountPercent", Number(e.target.value))}
                      className={selectClass}
                      {...invalid("restDiscountPercent")}
                    >
                      {restOptions.map((rest) => (
                        <option key={rest} value={rest}>
                          {rest === 100 ? "Gratis" : rest === 50 ? "Al 50%" : `Con ${rest}% de descuento`}
                        </option>
                      ))}
                    </select>
                    {fieldError("restDiscountPercent")}
                  </div>
                </div>
                <ItemPicker
                  label="Productos que cuentan"
                  options={options}
                  picked={targetKeys(draft.targets)}
                  onAdd={(key) => changeTargets(key, true)}
                  onRemove={(key) => changeTargets(key, false)}
                  placeholder="Productos, categorías o subcategorías"
                  error={errors.targets}
                  errorId={errorId("targets")}
                />
                <p className="text-xs text-muted-foreground">
                  Se pueden mezclar: Margarita + Mojito cuenta como un 2x1. El descuento va a las unidades más económicas.
                </p>
              </>
            )}

            {draft.kind === "combo" && (
              <>
                {numberField("comboPrice", "Precio del combo", undefined, "24000")}
                <div className="grid gap-2">
                  {draft.comboGroups.map((group, index) => (
                    <div key={index} className="grid gap-2 rounded-md border bg-background p-3">
                      <div className="flex items-center justify-between text-sm font-medium">
                        <span>
                          Grupo {index + 1}
                          {group.name.trim() ? ` · ${group.name.trim()}` : ""}
                        </span>
                        <span className="text-muted-foreground">elige 1</span>
                      </div>
                      <div className="flex items-end gap-2">
                        <div className="grid flex-1 gap-1.5">
                          <label htmlFor={`${baseId}-group-${index}`} className="text-sm font-medium">
                            Nombre del grupo {index + 1}
                          </label>
                          <Input
                            id={`${baseId}-group-${index}`}
                            value={group.name}
                            maxLength={60}
                            placeholder={["Sopa", "Principio", "Bebida"][index] ?? "Grupo"}
                            onChange={(e) => changeGroup(index, { name: e.target.value })}
                            className="h-11"
                            {...invalid(`comboGroups.${index}`)}
                          />
                        </div>
                        {draft.comboGroups.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-11 w-11"
                            aria-label={`Quitar grupo ${index + 1}`}
                            onClick={() => set("comboGroups", draft.comboGroups.filter((_, i) => i !== index))}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </Button>
                        )}
                      </div>
                      <ItemPicker
                        label={`Platos del grupo ${index + 1}`}
                        options={dishOptions}
                        picked={group.dishIds}
                        onAdd={(id) => changeGroup(index, { dishIds: [...group.dishIds, id] })}
                        onRemove={(id) => changeGroup(index, { dishIds: group.dishIds.filter((x) => x !== id) })}
                        placeholder="El cliente elige uno de estos platos"
                      />
                      {fieldError(`comboGroups.${index}`)}
                    </div>
                  ))}
                  {draft.comboGroups.length < MAX_GROUPS && (
                    <button
                      type="button"
                      onClick={() => set("comboGroups", [...draft.comboGroups, { name: "", dishIds: [] }])}
                      className="h-9 justify-self-start rounded-md px-2 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      + Agregar grupo
                    </button>
                  )}
                  {fieldError("comboGroups")}
                </div>
              </>
            )}

            {draft.kind === "bill_discount" && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  {discountTypeToggle}
                  {discountValueInput}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {numberField("minSubtotal", "Cuenta mínima", "Opcional", "80000")}
                  {numberField("maxDiscount", "Tope", "Opcional", "15000")}
                </div>
                <p className="text-xs text-muted-foreground">
                  Se calcula sobre el subtotal ya rebajado por otras promociones. Solo un descuento a la cuenta por orden.
                </p>
              </>
            )}
          </Step>

          <Step n={3} title="¿Cuándo?">
            <div className="grid gap-1.5">
              <span id={`${baseId}-days`} className="text-sm font-medium">
                Días
              </span>
              <div
                role="group"
                aria-labelledby={`${baseId}-days`}
                aria-describedby={errors.daysOfWeek ? errorId("daysOfWeek") : undefined}
                className="flex flex-wrap gap-1.5"
              >
                {DAYS.map((label, index) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={draft.days.includes(index + 1)}
                    onClick={() => toggleDay(index + 1)}
                    className={toggleClass}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {fieldError("daysOfWeek")}
            </div>
            {draft.windows.map((window, index) => {
              const suffix = index === 0 ? "" : ` (horario ${index + 1})`
              return (
                <div key={index} className="grid gap-1.5">
                  <div className="flex items-end gap-2">
                    <div className="grid flex-1 grid-cols-2 gap-3">
                      <div className="grid gap-1.5">
                        <label htmlFor={`${baseId}-from-${index}`} className="text-sm font-medium">
                          Desde{suffix}
                        </label>
                        <Input
                          id={`${baseId}-from-${index}`}
                          type="time"
                          value={window.from}
                          onChange={(e) => changeWindow(index, { from: e.target.value })}
                          className="h-11 tabular-nums"
                          {...invalid(`timeWindows.${index}`)}
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <label htmlFor={`${baseId}-to-${index}`} className="text-sm font-medium">
                          Hasta{suffix}
                        </label>
                        <Input
                          id={`${baseId}-to-${index}`}
                          type="time"
                          value={window.to}
                          onChange={(e) => changeWindow(index, { to: e.target.value })}
                          className="h-11 tabular-nums"
                          {...invalid(`timeWindows.${index}`)}
                        />
                      </div>
                    </div>
                    {draft.windows.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11"
                        aria-label={`Quitar horario ${index + 1}`}
                        onClick={() => set("windows", draft.windows.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    )}
                  </div>
                  {fieldError(`timeWindows.${index}`)}
                </div>
              )
            })}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Sin horas, aplica todo el día.</p>
              {draft.windows.length < MAX_WINDOWS && (
                <button
                  type="button"
                  onClick={() => set("windows", [...draft.windows, { from: "", to: "" }])}
                  className="h-9 rounded-md px-2 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  + Agregar horario
                </button>
              )}
            </div>
            {fieldError("timeWindows")}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <label htmlFor={`${baseId}-start`} className="text-sm font-medium">
                  Vigente desde
                </label>
                <Input
                  id={`${baseId}-start`}
                  type="date"
                  value={draft.startDate}
                  onChange={(e) => set("startDate", e.target.value)}
                  className="h-11"
                  {...invalid("startDate")}
                />
                {fieldError("startDate")}
              </div>
              <div className="grid gap-1.5">
                <label htmlFor={`${baseId}-end`} className="text-sm font-medium">
                  Hasta (opcional)
                </label>
                <Input
                  id={`${baseId}-end`}
                  type="date"
                  value={draft.endDate}
                  min={draft.startDate || undefined}
                  onChange={(e) => set("endDate", e.target.value)}
                  className="h-11"
                  {...invalid("endDate")}
                />
                {fieldError("endDate")}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Cuenta la hora en que se pide cada producto, no la hora del cobro.</p>
          </Step>

          <Step n={4} title="¿Dónde y con qué límites?">
            <div className="grid gap-1.5">
              <span id={`${baseId}-channels`} className="text-sm font-medium">
                Canales
              </span>
              <div
                role="group"
                aria-labelledby={`${baseId}-channels`}
                aria-describedby={errors.channels ? errorId("channels") : undefined}
                className="flex flex-wrap gap-1.5"
              >
                {CHANNELS.map((channel) => (
                  <button
                    key={channel.value}
                    type="button"
                    aria-pressed={draft.channels.includes(channel.value)}
                    onClick={() => toggleChannel(channel.value)}
                    className={toggleClass}
                  >
                    {channel.label}
                  </button>
                ))}
              </div>
              {fieldError("channels")}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid content-start gap-1.5">
                <label htmlFor={`${baseId}-uses`} className="text-sm font-medium">
                  Máximo por cuenta
                </label>
                <select
                  id={`${baseId}-uses`}
                  value={draft.maxUses}
                  onChange={(e) => set("maxUses", e.target.value)}
                  className={selectClass}
                  {...invalid("maxUsesPerOrder")}
                >
                  <option value="">Sin límite</option>
                  {usesOptions.map((uses) => (
                    <option key={uses} value={uses}>
                      {uses === "1" ? "1 vez" : `${uses} veces`}
                    </option>
                  ))}
                </select>
                {fieldError("maxUsesPerOrder")}
              </div>
              <div className="grid content-start gap-1.5">
                <label htmlFor={`${baseId}-mode`} className="text-sm font-medium">
                  Cómo se aplica
                </label>
                <select
                  id={`${baseId}-mode`}
                  value={draft.mode}
                  onChange={(e) => set("mode", e.target.value as PromotionMode)}
                  className={selectClass}
                >
                  {MODES.map((mode) => (
                    <option key={mode.value} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </Step>

          <section
            aria-labelledby={`${baseId}-summary`}
            aria-live="polite"
            className="grid gap-2 rounded-xl border border-primary/50 bg-primary/10 px-4 py-3.5"
          >
            <h3 id={`${baseId}-summary`} className="text-xs font-semibold uppercase tracking-widest text-primary">
              Así funcionará
            </h3>
            <p className="text-sm">{sentence}</p>
            <p className="text-sm text-muted-foreground">{schedule}</p>
            {preview.length > 0 ? (
              <div aria-label="Vista previa en la cuenta" className="grid gap-1 rounded-lg border bg-card px-3 py-2.5 text-sm">
                {preview.map((line, index) => (
                  <div
                    key={index}
                    className={cn(
                      "flex justify-between gap-3 tabular-nums",
                      line.discount && "border-l-2 border-status-ok-line pl-2.5 text-status-ok-fg",
                    )}
                  >
                    <span>{line.label}</span>
                    <span>{line.amount}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Completa el beneficio y los productos para ver un ejemplo en la cuenta.</p>
            )}
          </section>

          {competing.length > 0 && (
            <div
              role="note"
              className="rounded-lg border border-status-warning-line bg-status-warning-bg px-3 py-2.5 text-sm text-status-warning-fg"
            >
              <strong>
                {competing.length === 1 ? "Compite con otra promoción" : `Compite con ${competing.length} promociones`} en{" "}
                {platos(new Set(competing.flatMap((c) => c.dishNames)).size)}:
              </strong>{" "}
              {competing.map(({ promotion: other, dishNames }) => (
                <span key={other.id}>
                  {dishNames.length <= 3 ? dishNames.join(", ") : `${dishNames.slice(0, 3).join(", ")} y ${dishNames.length - 3} más`}{" "}
                  {dishNames.length === 1 ? "también está" : "también están"} en «{other.name}»
                  {other.active ? "" : " (pausada)"}.{" "}
                </span>
              ))}
              Si las dos aplican a la vez, gana la que más ahorre al cliente.
            </div>
          )}

          {errors.form && (
            <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {errors.form}
            </p>
          )}
          {/* Enter in a field submits through the footer button. */}
          <button type="submit" hidden aria-hidden tabIndex={-1} />
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3">
          <div className="flex gap-2">
            {current && (
              <Button type="button" variant="outline" className="min-h-11" disabled={busy !== null} onClick={() => void toggleActive()}>
                {busy === "toggle" && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                {current.active ? "Pausar" : "Reactivar"}
              </Button>
            )}
            {promotion && (
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 text-destructive hover:text-destructive"
                disabled={busy !== null}
                onClick={() => setConfirmDelete(true)}
              >
                Eliminar
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" className="min-h-11" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="button" className="min-h-11" disabled={busy !== null} onClick={() => void save()}>
              {busy === "save" && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              {promotion ? "Guardar cambios" : "Crear promoción"}
            </Button>
          </div>
        </div>

        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Eliminar «{promotion?.name}»?</AlertDialogTitle>
              <AlertDialogDescription>
                Deja de aplicarse en los pedidos nuevos y sale de esta lista. Esta acción no se puede deshacer; para dejarla de
                lado por un tiempo, usa Pausar.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="min-h-11">Cancelar</AlertDialogCancel>
              <AlertDialogAction
                className="min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={busy === "delete"}
                onClick={(e) => {
                  e.preventDefault()
                  void remove()
                }}
              >
                Eliminar promoción
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  )
}
