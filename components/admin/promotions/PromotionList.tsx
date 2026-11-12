"use client"

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { BadgePercent } from "lucide-react"
import { log } from "@/lib/log"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/admin/common/EmptyState"
import { useToast } from "@/hooks/use-toast"
import type { PromotionDto as Promotion } from "@/lib/api/catalog"
import { ADMIN_LIST_STALE_MS, catalogKeys, errorMessage, fetchPromotions, invalidateCatalogReaders } from "@/lib/admin/catalog"
import { PromotionForm } from "./PromotionForm"
import { Pill, StatePill } from "./PromotionPills"
import {
  PROMOTION_TABS,
  formatPesos,
  inTab,
  isManual,
  kindIcon,
  promotionPills,
  statePill,
  tabCounts,
  usageText,
  type PromotionTab,
} from "./promotion-model"

/**
 * promociones T5 (S9) — the Promociones list of the 02 artboard: header cards,
 * tabs with counts and one row per promotion (kind, name, the server's
 * sentence, pills, uses and discount of the last 30 days, the state from
 * `schedule`). A row opens the editor (T6, S10).
 *
 * The API gives each promotion's last 30 days only, so the discount card sums
 * those; there is no weekly figure, sales total or bill count to show "% de la
 * venta" or "Venta con promoción", and the page does not invent them.
 */

const MINUTE = 60_000

function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), MINUTE)
    return () => clearInterval(timer)
  }, [])
  return now
}

function StatCard({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <div role="group" aria-label={title} className="rounded-xl border bg-card px-4 py-3.5 text-card-foreground">
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

function PromotionRow({ promotion, now, selected, onOpen }: { promotion: Promotion; now: Date; selected: boolean; onOpen: () => void }) {
  const icon = kindIcon(promotion)
  const state = statePill(promotion, now)
  const usage = usageText(promotion.stats)
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onOpen}
      className={cn(
        "grid w-full grid-cols-[44px_minmax(0,1fr)] items-center gap-x-3.5 gap-y-2 rounded-xl border bg-card px-4 py-3.5 text-left transition-colors hover:border-foreground/20",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "md:grid-cols-[44px_minmax(0,1fr)_150px_auto]",
        selected && "border-primary/50 shadow-[inset_3px_0_0_hsl(var(--primary))]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "row-span-3 grid h-11 w-11 place-items-center self-start rounded-xl border text-[13px] font-bold md:row-span-1 md:self-center",
          icon.manual
            ? "border-status-warning-line bg-status-warning-bg text-status-warning-fg"
            : "border-primary/50 bg-primary/10 text-primary",
        )}
      >
        {icon.label}
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2 font-semibold">
          <span className="break-words [overflow-wrap:anywhere]">{promotion.name}</span>
          {isManual(promotion.mode) && <Pill tone="warn">Manual</Pill>}
        </span>
        <span className="mt-0.5 block text-[13px] text-foreground/80">{promotion.sentence}</span>
        <span className="mt-2 flex flex-wrap gap-1.5">
          {promotionPills(promotion).map((pill) => (
            <Pill key={pill}>{pill}</Pill>
          ))}
        </span>
      </span>
      <span className="col-start-2 text-[13px] md:col-start-auto md:text-right">
        <strong className="block text-[15px] tabular-nums">{usage.main}</strong>
        <span className="text-xs text-muted-foreground">{usage.sub}</span>
      </span>
      <span className="col-start-2 md:col-start-auto md:justify-self-end">
        <StatePill label={state.label} tone={state.tone} />
      </span>
    </button>
  )
}

export function PromotionList() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const now = useNow()
  const [tab, setTab] = useState<PromotionTab>("all")
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Promotion | null>(null)
  const tabRefs = useRef(new Map<PromotionTab, HTMLButtonElement>())

  const {
    data: promotions = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<Promotion[]>({
    queryKey: catalogKeys.promotions,
    queryFn: fetchPromotions,
    staleTime: ADMIN_LIST_STALE_MS,
  })

  useEffect(() => {
    if (isError) log.error("Error loading promotions:", { error: String(error) })
  }, [isError, error])

  const counts = useMemo(() => tabCounts(promotions), [promotions])
  const shown = useMemo(() => promotions.filter((p) => inTab(p, tab)), [promotions, tab])
  const activeNow = promotions.filter((p) => p.schedule.reason === "active")
  const endingFirst = activeNow
    .filter((p) => p.schedule.endsAt)
    .sort((a, b) => (a.schedule.endsAt ?? "").localeCompare(b.schedule.endsAt ?? ""))[0]
  const granted = promotions.reduce((sum, p) => sum + p.stats.discountLast30Days, 0)

  const openEditor = (promotion: Promotion | null) => {
    setEditing(promotion)
    setEditorOpen(true)
  }
  const refresh = () => invalidateCatalogReaders(queryClient, catalogKeys.promotions)

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
    const edge = event.key === "Home" ? 0 : event.key === "End" ? PROMOTION_TABS.length - 1 : null
    if (!step && edge === null) return
    event.preventDefault()
    const next = PROMOTION_TABS[edge ?? (index + step + PROMOTION_TABS.length) % PROMOTION_TABS.length].id
    setTab(next)
    tabRefs.current.get(next)?.focus()
  }

  const newButton = (
    <Button className="min-h-11" onClick={() => openEditor(null)}>
      + Nueva promoción
    </Button>
  )

  return (
    <section className="grid min-w-0 gap-4" aria-label="Lista de promociones">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Cada promoción se aplica sola en su horario y sus canales; las manuales las elige la caja.
        </p>
        {newButton}
      </div>

      {isLoading ? (
        <p role="status" className="py-8 text-center text-sm text-muted-foreground">
          Cargando promociones…
        </p>
      ) : isError ? (
        <EmptyState
          icon={BadgePercent}
          title="No se pudieron cargar las promociones"
          description={errorMessage(error)}
          action={
            <Button variant="outline" className="min-h-11" onClick={() => void refetch()}>
              Reintentar
            </Button>
          }
        />
      ) : promotions.length === 0 ? (
        <EmptyState
          icon={BadgePercent}
          title="Aún no hay promociones"
          description="Crea la primera: un 2x1 en cócteles, un menú ejecutivo o un descuento a la cuenta."
          action={newButton}
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <StatCard
              title="Aplicando ahora"
              value={String(activeNow.length)}
              hint={
                endingFirst
                  ? `${endingFirst.name} termina a las ${endingFirst.schedule.endsAt}`
                  : activeNow.length
                    ? "Todo el día"
                    : "Ninguna en este momento"
              }
            />
            <StatCard title="Descuento otorgado · 30 días" value={formatPesos(granted)} hint="Suma de todas las promociones" />
          </div>

          <div role="tablist" aria-label="Estado" className="flex gap-1 overflow-x-auto border-b">
            {PROMOTION_TABS.map((t, index) => (
              <button
                key={t.id}
                ref={(node) => {
                  if (node) tabRefs.current.set(t.id, node)
                  else tabRefs.current.delete(t.id)
                }}
                type="button"
                role="tab"
                id={`promotions-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls="promotions-panel"
                tabIndex={tab === t.id ? 0 : -1}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => onTabKey(e, index)}
                className={cn(
                  "-mb-px h-11 whitespace-nowrap border-b-2 border-transparent px-3 text-sm text-muted-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  tab === t.id && "border-primary font-medium text-foreground",
                )}
              >
                {t.label}
                <span className="ml-1.5 inline-block min-w-5 rounded-full border bg-card px-1.5 text-xs tabular-nums">{counts[t.id]}</span>
              </button>
            ))}
          </div>

          <div id="promotions-panel" role="tabpanel" aria-labelledby={`promotions-tab-${tab}`} className="grid gap-2">
            {shown.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No hay promociones en esta pestaña.</p>
            ) : (
              shown.map((promotion) => (
                <PromotionRow
                  key={promotion.id}
                  promotion={promotion}
                  now={now}
                  selected={editorOpen && editing?.id === promotion.id}
                  onOpen={() => openEditor(promotion)}
                />
              ))
            )}
          </div>
        </>
      )}

      <PromotionForm
        open={editorOpen}
        onOpenChange={setEditorOpen}
        promotion={editing}
        promotions={promotions}
        onSaved={(saved, created) => {
          void refresh()
          setEditorOpen(false)
          toast({ title: created ? "Promoción creada" : "Cambios guardados", description: saved.name })
        }}
        onChanged={(saved) => {
          void refresh()
          toast({ title: saved.active ? "Promoción reactivada" : "Promoción pausada", description: saved.name })
        }}
        onDeleted={(deleted) => {
          void refresh()
          setEditorOpen(false)
          setEditing(null)
          toast({ title: "Promoción eliminada", description: deleted.name })
        }}
      />
    </section>
  )
}
