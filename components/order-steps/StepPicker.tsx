"use client"

import { useEffect, useReducer, useRef, type ReactNode } from "react"
import { ArrowLeft, Check, ChevronRight, Minus, Plus } from "lucide-react"

import type { MenuTreeCategoryDto, MenuTreeDishDto } from "@/lib/api/catalog"
import { categoryMeta, dishCount, dishesOf, NO_SUBCATEGORY, skipsSubcategories, subcategoryChoices } from "@/lib/order-steps/menu"
import {
  addedMessage,
  canGoToStep,
  initialStepState,
  soldOutMessage,
  STEP_LABELS,
  STEP_SHORT_LABELS,
  stepReducer,
  type Step,
  type StepAction,
} from "@/lib/order-steps/steps"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/utils/helpers"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ToastAction } from "@/components/ui/toast"
import { CategoryIcon } from "./CategoryIcon"
import { categoryTone } from "./tones"

export interface StepPickerItem {
  dish: MenuTreeDishDto
  category: MenuTreeCategoryDto
  quantity: number
  /** The optional note for the kitchen, trimmed; absent when empty. */
  comments?: string
}

export interface StepPickerProps {
  /** `GET /catalog/menu/tree` categories; undefined while loading. */
  menu: MenuTreeCategoryDto[] | undefined
  isError?: boolean
  onRetry?: () => void
  /** Adds the picked dish; a returned function undoes it from the toast ("Deshacer"). */
  onAdd: (item: StepPickerItem) => (() => void) | void
  /** "Atrás" on step 1: leave the picker. */
  onExit: () => void
  exitLabel?: string
  /** Top bar content (who the order is for). */
  header?: ReactNode
  /** Middle of the sticky bar: the order summary. */
  summary?: ReactNode
  /** Right of the sticky bar outside step 4 (on step 4 it is "Agregar n"). */
  primaryAction?: ReactNode
  /** Side column from 1024 px (the order so far). */
  aside?: ReactNode
  /** Replaces the steps (e.g. the order review); "Atrás" calls `onCloseOverlay`. */
  overlay?: ReactNode
  onCloseOverlay?: () => void
  /**
   * Inside a panel (the delivery drawer, T11) instead of full screen: tiles
   * follow the panel (2 columns on phone, 3 from 640 px) and, without
   * `header`, the top bar is left out.
   */
  embedded?: boolean
  className?: string
}

const TILE =
  "relative flex min-h-[140px] min-w-0 flex-col items-start gap-2 overflow-hidden rounded-[20px] border-[1.5px] py-3.5 pl-[18px] pr-3 text-left text-fg " +
  "shadow-[0_4px_0_-1px_rgba(9,9,11,.18)] dark:shadow-[0_4px_0_-1px_rgba(0,0,0,.55)] md:min-h-[156px] lg:min-h-[168px] min-[1440px]:min-h-[180px] " +
  "motion-safe:transition-transform motion-safe:active:translate-y-0.5 motion-safe:active:scale-[.985] " +
  "focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-4 focus-visible:outline-focus"
const FULL_GRID = "grid grid-cols-2 gap-2.5 md:grid-cols-3 md:gap-3 xl:grid-cols-4 xl:gap-3.5"
const EMBEDDED_GRID = "grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3"
const FOCUS = "focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"

function Bar({ className }: { className: string }) {
  return <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1.5", className)} />
}

function TileIcon({ category, large }: { category: MenuTreeCategoryDto; large?: boolean }) {
  const tone = categoryTone(category.color)
  return (
    <span
      aria-hidden
      className={cn(
        "grid flex-none place-items-center rounded-[14px] bg-card shadow-[inset_0_0_0_1px_var(--line-strong)]",
        large ? "h-[52px] w-[52px]" : "h-12 w-12 min-[1440px]:h-14 min-[1440px]:w-14",
        tone.icon,
      )}
    >
      <CategoryIcon name={category.icon} className="h-[26px] w-[26px]" />
    </span>
  )
}

function StageHeading({ title, hint, headingRef }: { title: string; hint?: string; headingRef: React.Ref<HTMLHeadingElement> }) {
  return (
    <div className="mx-0.5 mb-3 flex min-w-0 flex-wrap items-baseline justify-between gap-2">
      <h2 ref={headingRef} tabIndex={-1} className="min-w-0 text-[22px] font-semibold leading-tight tracking-tight outline-none xl:text-[26px]">
        {title}
      </h2>
      {hint && <p className="text-sm text-muted-fg">{hint}</p>}
    </div>
  )
}

/**
 * The shared, data-driven order picker (T10, S5): one level per screen with
 * big tiles, Categoría → Subcategoría → Plato → Agregar, then back to
 * Categoría. It owns only the step state; the consumer owns the order
 * (`onAdd`, the summary and actions slots), so the waiter and delivery (T11)
 * feed it the same menu tree.
 */
export function StepPicker({
  menu,
  isError,
  onRetry,
  onAdd,
  onExit,
  exitLabel = "Salir",
  header,
  summary,
  primaryAction,
  aside,
  overlay,
  onCloseOverlay,
  embedded = false,
  className,
}: StepPickerProps) {
  const GRID = embedded ? EMBEDDED_GRID : FULL_GRID
  const showHeader = !embedded || header != null
  const [state, rawDispatch] = useReducer(stepReducer, initialStepState)
  const { toast } = useToast()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const direction = useRef<"fwd" | "back">("fwd")

  const dispatch = (action: StepAction) => {
    direction.current = action.type === "back" || action.type === "crumb" || action.type === "added" ? "back" : "fwd"
    rawDispatch(action)
  }

  const category = menu?.find((entry) => entry.id === state.categoryId) ?? null
  const dish = category?.dishes.find((entry) => entry.id === state.dishId) ?? null
  // The menu changed under the picker (category or dish gone): start over.
  const step: Step = (state.step > 1 && !category) || (state.step === 4 && !dish) ? 1 : state.step
  const reviewing = overlay != null

  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0
    headingRef.current?.focus({ preventScroll: true })
  }, [step, state.categoryId, state.subcategoryId, reviewing])

  const add = () => {
    if (!category || !dish) return
    const comments = state.note.trim()
    const undo = onAdd({ dish, category, quantity: state.quantity, ...(comments ? { comments } : {}) })
    toast({
      title: addedMessage(state.quantity, dish.name),
      ...(undo
        ? {
            action: (
              <ToastAction altText="Deshacer" onClick={undo} className="min-h-11 px-4">
                Deshacer
              </ToastAction>
            ),
          }
        : {}),
    })
    dispatch({ type: "added" })
  }

  const back = () => {
    if (reviewing) onCloseOverlay?.()
    else if (step === 1) onExit()
    else dispatch({ type: "back" })
  }

  const subcategoryValue =
    step >= 3 && category ? (state.skipped || state.subcategoryId === null ? NO_SUBCATEGORY : (category.subcategories.find((sub) => sub.id === state.subcategoryId)?.name ?? "—")) : "—"
  const crumbValues: Record<Step, string> = {
    1: category && step > 1 ? category.name : "Elige",
    2: category && state.skipped ? NO_SUBCATEGORY : subcategoryValue,
    3: dish && step === 4 ? dish.name : "—",
    4: step === 4 ? "Cantidad" : "—",
  }

  const renderStage = () => {
    if (isError && !menu) {
      return (
        <div className="grid max-w-md gap-3 py-8">
          <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none">
            No se pudo cargar el menú.
          </h2>
          {onRetry && (
            <Button variant="outline" className="h-12 w-fit" onClick={onRetry}>
              Reintentar
            </Button>
          )}
        </div>
      )
    }
    if (!menu) {
      return (
        <div className={GRID} aria-busy="true" aria-label="Cargando menú">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-[140px] rounded-[20px] md:h-[156px]" />
          ))}
        </div>
      )
    }
    if (menu.length === 0) {
      return (
        <h2 ref={headingRef} tabIndex={-1} className="py-8 text-lg font-semibold text-fg-2 outline-none">
          No hay categorías en el menú.
        </h2>
      )
    }

    if (step === 1 || !category) {
      return (
        <>
          <StageHeading headingRef={headingRef} title="¿Qué categoría?" hint="Siempre en el mismo orden" />
          <div className={GRID}>
            {menu.map((entry) => {
              const tone = categoryTone(entry.color)
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={cn(TILE, tone.tile)}
                  onClick={() => dispatch({ type: "category", id: entry.id, skipsSubcategories: skipsSubcategories(entry) })}
                >
                  <Bar className={tone.bar} />
                  <TileIcon category={entry} />
                  <span className="mt-auto min-w-0 max-w-full text-lg font-semibold leading-snug [overflow-wrap:anywhere] lg:text-[19px] min-[1440px]:text-xl">
                    {entry.name}
                  </span>
                  <span className="text-sm leading-tight text-fg-2">{categoryMeta(entry)}</span>
                </button>
              )
            })}
          </div>
        </>
      )
    }

    const tone = categoryTone(category.color)

    if (step === 2) {
      return (
        <>
          <StageHeading headingRef={headingRef} title={category.name} hint="Elige subcategoría" />
          <div className={GRID}>
            {subcategoryChoices(category).map((choice) => (
              <button
                key={choice.id ?? "none"}
                type="button"
                className={cn(TILE, tone.tile)}
                onClick={() => dispatch({ type: "subcategory", id: choice.id })}
              >
                <Bar className={tone.bar} />
                <TileIcon category={category} />
                <span className="mt-auto min-w-0 max-w-full text-lg font-semibold leading-snug [overflow-wrap:anywhere] lg:text-[19px] min-[1440px]:text-xl">
                  {choice.name}
                </span>
                <span className="text-sm leading-tight text-fg-2">{dishCount(choice.count)}</span>
              </button>
            ))}
          </div>
        </>
      )
    }

    if (step === 3) {
      const subName = state.skipped ? null : crumbValues[2]
      const dishes = dishesOf(category, state.subcategoryId, state.skipped)
      return (
        <>
          <StageHeading
            headingRef={headingRef}
            title={state.skipped || !subName ? category.name : subName}
            hint={state.skipped ? "Elige el plato" : `${category.name} · elige el plato`}
          />
          {state.skipped && (
            <p className="mx-0.5 -mt-1 mb-3 flex items-center gap-2 text-sm text-fg-2">
              <ChevronRight className="h-4 w-4 flex-none" aria-hidden />
              {category.name} no tiene subcategorías: saltaste directo a los platos.
            </p>
          )}
          {dishes.length === 0 ? (
            <p className="py-6 text-fg-2">No hay platos en esta categoría.</p>
          ) : (
            <div className={GRID}>
              {dishes.map((entry) => {
                const out = !entry.available
                return (
                  <button
                    key={entry.id}
                    type="button"
                    aria-disabled={out || undefined}
                    aria-label={`${entry.name}, ${formatCurrency(entry.price)}${out ? ", agotado" : ""}`}
                    className={cn(
                      TILE,
                      out
                        ? "cursor-not-allowed border-dashed border-line-strong bg-surface-2 shadow-none motion-safe:active:translate-y-0 motion-safe:active:scale-100"
                        : tone.tile,
                    )}
                    onClick={() => {
                      if (out) toast({ title: soldOutMessage(entry.name) })
                      dispatch({ type: "dish", id: entry.id, available: entry.available })
                    }}
                  >
                    <Bar className={out ? "bg-line-strong" : tone.bar} />
                    <span
                      className={cn(
                        "min-w-0 max-w-full text-[17px] font-semibold leading-snug [overflow-wrap:anywhere] lg:text-lg",
                        out && "text-fg-2 line-through decoration-muted-fg",
                      )}
                    >
                      {entry.name}
                    </span>
                    <span className="mt-auto flex w-full min-w-0 flex-wrap items-center justify-between gap-1.5">
                      <span className="flex flex-col">
                        {entry.originalPrice != null && entry.originalPrice > entry.price && (
                          <span className="text-xs tabular-nums text-muted-fg line-through">{formatCurrency(entry.originalPrice)}</span>
                        )}
                        <span className="text-lg font-semibold tabular-nums">{formatCurrency(entry.price)}</span>
                      </span>
                      {out && (
                        <span className="inline-flex h-7 flex-none items-center whitespace-nowrap rounded-full border border-line-strong bg-status-reserved-bg px-3 text-[13px] font-medium text-status-reserved-fg">
                          Agotado
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )
    }

    // Step 4: Agregar.
    const where = state.skipped || !crumbValues[2] || crumbValues[2] === "—" ? category.name : crumbValues[2]
    return (
      <div className="grid max-w-[640px] gap-4">
        <div className={cn("relative flex min-w-0 items-center gap-3.5 overflow-hidden rounded-[20px] border-[1.5px] py-3.5 pl-5 pr-4", tone.tile)}>
          <Bar className={tone.bar} />
          <TileIcon category={category} large />
          <div className="min-w-0">
            <h2 ref={headingRef} tabIndex={-1} className="text-[22px] font-semibold leading-tight outline-none [overflow-wrap:anywhere]">
              {dish!.name}
            </h2>
            <p className="mt-1 text-sm tabular-nums text-fg-2">
              {formatCurrency(dish!.price)} c/u · {where}
            </p>
          </div>
        </div>

        <div>
          <p id="step-qty" className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-fg-2">
            Cantidad
          </p>
          <div role="group" aria-labelledby="step-qty" className="grid grid-cols-[76px_minmax(0,1fr)_76px] items-center gap-2.5">
            <button
              type="button"
              aria-label="Quitar uno"
              disabled={state.quantity <= 1}
              onClick={() => dispatch({ type: "quantity", delta: -1 })}
              className={cn("grid h-[76px] place-items-center rounded-[20px] border border-line-strong bg-card text-fg disabled:cursor-not-allowed disabled:border-line disabled:text-muted-fg", FOCUS)}
            >
              <Minus className="h-8 w-8" aria-hidden />
            </button>
            <output aria-live="polite" className="text-center text-[40px] font-semibold tabular-nums">
              {state.quantity}
            </output>
            <button
              type="button"
              aria-label="Sumar uno"
              onClick={() => dispatch({ type: "quantity", delta: 1 })}
              className={cn("grid h-[76px] place-items-center rounded-[20px] border border-line-strong bg-card text-fg", FOCUS)}
            >
              <Plus className="h-8 w-8" aria-hidden />
            </button>
          </div>
        </div>

        {dish!.allowComments && (
          <div>
            <label htmlFor="step-note" className="mb-2 block text-[13px] font-semibold uppercase tracking-wider text-fg-2">
              Nota para cocina (opcional)
            </label>
            <input
              id="step-note"
              type="text"
              value={state.note}
              maxLength={200}
              placeholder="Ej.: sin cebolla"
              onChange={(event) => dispatch({ type: "note", note: event.target.value })}
              className={cn("min-h-[52px] w-full rounded-[14px] border border-line-strong bg-card px-3.5 py-3 text-[15px] text-fg placeholder:text-muted-fg", FOCUS)}
            />
          </div>
        )}

        <Button className="h-14 rounded-[18px] text-base" onClick={add}>
          <Plus className="mr-1.5 h-5 w-5" aria-hidden />
          Agregar {state.quantity} · <span className="tabular-nums">{formatCurrency(state.quantity * dish!.price)}</span>
        </Button>
      </div>
    )
  }

  const addMode = !reviewing && step === 4 && dish
  const stepInfo = reviewing ? "Revisando el pedido" : `Paso ${step} de 4 · ${STEP_LABELS[step]}`

  return (
    <div
      className={cn(
        "grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] bg-canvas text-fg",
        showHeader ? "grid-rows-[auto_auto_minmax(0,1fr)_auto]" : "grid-rows-[auto_minmax(0,1fr)_auto]",
        aside && "lg:grid-cols-[minmax(0,1fr)_340px] min-[1440px]:grid-cols-[minmax(0,1fr)_380px]",
        className,
      )}
    >
      {showHeader && (
        <header className="col-span-full flex min-w-0 items-center gap-2.5 border-b border-line px-3 py-2 md:px-5 md:py-2.5">{header}</header>
      )}

      <nav aria-label="Pasos para agregar" className="min-w-0 border-b border-line p-2 md:px-5 md:py-2.5">
        <ol className="grid grid-cols-4 gap-1 md:gap-2">
          {([1, 2, 3, 4] as Step[]).map((n) => {
            const current = !reviewing && n === step
            const reachable = !reviewing && canGoToStep({ ...state, step }, n)
            const done = !reviewing && n < step
            const skip = n === 2 && state.skipped && step > 1
            const value = crumbValues[n]
            const label = `Paso ${n}, ${STEP_LABELS[n]}${value !== "—" ? `: ${value}` : ""}${reachable ? ". Volver a este paso" : ""}`
            return (
              <li key={n} className="min-w-0">
                <button
                  type="button"
                  aria-label={label}
                  aria-current={current ? "step" : undefined}
                  disabled={!(reachable || current)}
                  onClick={() => dispatch({ type: "crumb", step: n })}
                  className={cn(
                    "flex min-h-12 w-full min-w-0 flex-col items-start justify-center gap-0.5 rounded-xl border border-transparent px-1.5 py-1 text-left text-muted-fg md:min-h-[52px] md:px-3",
                    current && "border-brand-line bg-brand-tint text-fg",
                    done && !current && "text-fg-2",
                    "disabled:cursor-default",
                    FOCUS,
                  )}
                >
                  <span className="flex max-w-full min-w-0 items-center gap-1.5 whitespace-nowrap text-xs font-semibold md:text-[13px]">
                    <i
                      aria-hidden
                      className={cn(
                        "inline-grid h-[18px] w-[18px] flex-none place-items-center rounded-full border border-line-strong text-[11px] not-italic",
                        current && "border-brand bg-brand text-brand-contrast",
                      )}
                    >
                      {done && !skip ? <Check className="h-3 w-3" /> : n}
                    </i>
                    <span className="truncate md:hidden">{STEP_SHORT_LABELS[n]}</span>
                    <span className="hidden truncate md:inline">{STEP_LABELS[n]}</span>
                  </span>
                  <span className={cn("block max-w-full truncate text-[12.5px] text-fg-2 md:text-sm", skip && "italic", !(reachable || current) && "text-muted-fg")}>
                    {value}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </nav>

      <main ref={mainRef} className="min-h-0 min-w-0 overflow-y-auto overscroll-contain">
        <div
          key={reviewing ? "review" : `${step}-${state.categoryId}-${state.subcategoryId}`}
          className={cn(
            "min-w-0 px-3 pb-5 pt-3 md:px-5 md:pb-6 md:pt-[18px] xl:px-7 xl:pb-7 xl:pt-[22px]",
            "motion-safe:animate-in motion-safe:fade-in-50 motion-safe:duration-200",
            direction.current === "back" ? "motion-safe:slide-in-from-left-6" : "motion-safe:slide-in-from-right-6",
          )}
        >
          {reviewing ? overlay : renderStage()}
        </div>
      </main>

      <footer className="grid min-w-0 grid-cols-2 gap-2 border-t border-line bg-card px-3 pb-[calc(10px+env(safe-area-inset-bottom))] pt-2 md:grid-cols-[160px_minmax(0,1fr)_220px] md:items-center md:px-5 md:pb-3 md:pt-2.5 lg:grid-cols-[200px_minmax(0,1fr)_240px]">
        {summary && (
          // From 1024 px the side column carries the order, so the bar keeps only the step.
          <div className={cn("col-span-2 min-w-0 md:col-span-1 md:col-start-2 md:row-start-1", aside && "lg:hidden")}>{summary}</div>
        )}
        <Button
          variant="outline"
          onClick={back}
          aria-label={reviewing ? "Volver a los pasos" : step === 1 ? undefined : "Volver al paso anterior"}
          className="h-[60px] justify-start rounded-[18px] pl-4 text-[17px] font-semibold md:col-start-1 md:row-start-1"
        >
          <ArrowLeft className="mr-1.5 h-5 w-5" aria-hidden />
          {step === 1 && !reviewing ? exitLabel : "Atrás"}
        </Button>
        <div className="min-w-0 md:col-start-3 md:row-start-1 [&>button]:h-[60px] [&>button]:w-full [&>button]:rounded-[18px]">
          {addMode ? (
            <Button aria-label={`Agregar ${state.quantity} ${dish.name} al pedido`} onClick={add} className="text-base">
              <Plus className="mr-1.5 h-5 w-5" aria-hidden />
              Agregar <span className="ml-1.5 inline-grid h-6 min-w-6 place-items-center rounded-full bg-btn-foreground px-1.5 text-[13px] tabular-nums text-btn">{state.quantity}</span>
            </Button>
          ) : (
            primaryAction
          )}
        </div>
        <span
          aria-live="polite"
          className={cn("sr-only", aside && "lg:not-sr-only lg:col-start-2 lg:row-start-1 lg:truncate lg:text-sm lg:text-muted-fg")}
        >
          {stepInfo}
        </span>
      </footer>

      {aside && (
        <aside
          aria-label="Pedido"
          className="hidden min-h-0 flex-col gap-2.5 overflow-y-auto border-l border-line bg-surface px-5 py-[18px] lg:col-start-2 lg:row-span-3 lg:row-start-2 lg:flex"
        >
          {aside}
        </aside>
      )}
    </div>
  )
}
