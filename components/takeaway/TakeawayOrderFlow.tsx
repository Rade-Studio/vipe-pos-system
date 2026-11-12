"use client"

import { useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, ChevronRight, Send, ShoppingBag } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ToastAction } from "@/components/ui/toast"
import { StepPicker, type StepPickerItem } from "@/components/order-steps/StepPicker"
import { OrderColumn, OrderReview, lineCount, lineTotal } from "@/components/order-steps/OrderReview"
import { PromotionStrip } from "@/components/promotions/PromotionStrip"
import { PromotionsSheet } from "@/components/promotions/PromotionsSheet"
import { ComboBuilder } from "@/components/promotions/ComboBuilder"
import { PromotionNudge, WindowEndingWarning, type OrderPricing } from "@/components/promotions/OrderPromotions"
import { ModifierSheet, type ModifierSheetResult } from "@/components/modifiers/ModifierSheet"
import { useCartStore } from "@/store/useCartStore"
import { MENU_TREE_KEY, useMenuTree } from "@/hooks/use-menu-tree"
import { usePromotionsToday } from "@/hooks/use-promotions"
import { usePricingPreview } from "@/hooks/use-pricing-preview"
import { useToast } from "@/hooks/use-toast"
import { invalidationsFor } from "@/hooks/inventory/invalidations"
import {
  addItemsToOrder,
  combosFromCart,
  create as createOrder,
  orderConflictOf,
  orderItemsFromCart,
  type ApiOrderItem,
  type OrderDto,
  type StockShortage,
} from "@/lib/api/orders"
import { clockTime } from "@/lib/order-steps/details"
import { ApiError } from "@/lib/api/errors"
import { sendCommand } from "@/lib/api/print"
import { usePrintingEnabled } from "@/lib/api/printing"
import { dishIdFromCartItemId } from "@/lib/menu/cart-dish-id"
import { cartLineKey } from "@/lib/modifiers/cart"
import { modifiersExtra, selectionOf } from "@/lib/modifiers/rules"
import {
  categoryTag,
  comboSavingText,
  comboTiles,
  dishTag,
  draftDiscounts,
  isComboLine,
  quickAdds,
  scheduleShort,
  sellsText,
  sentPreviewDiscounts,
  stripState,
  subcategoryTag,
  windowWarning,
  type CartCombo,
  type DiscountRow,
  type QuickAdd,
} from "@/lib/promotions/waiter"
import { useConfigStore } from "@/store/use-config-store"
import { log } from "@/lib/log"
import { formatCurrency } from "@/utils/helpers"
import type { Order, OrderItem } from "@/types"
import type { TakeawayCustomer } from "./customer"

interface TakeawayOrderFlowProps {
  customer: TakeawayCustomer
  /** M5b: an open takeaway order the new lines are added to (as a table's order); absent = a new order. */
  order?: Order
  /** Back without sending: the cart is dropped. */
  onClose: () => void
  /** The order was created or its new lines added (and the comanda queued when the restaurant prints). */
  onSent: (order: OrderDto) => void
}

const NO_LINES: readonly never[] = []

/**
 * S8: a new "Para llevar" order, taken with the waiter's step flow (StepPicker,
 * order review, combos, options) on the takeaway channel: the strip, the tags
 * and the pricing preview are those of "Para llevar". The order has no table;
 * it is created with the customer and paid at the cashier like a table order.
 */
export function TakeawayOrderFlow({ customer, order, onClose, onSent }: TakeawayOrderFlowProps) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const printingEnabled = usePrintingEnabled()
  const inventoryControlEnabled = useConfigStore((state) => state.inventoryControlEnabled)
  // One cart slot per flow, never a table id.
  const [cartKey] = useState(() => `takeaway:${crypto.randomUUID()}`)
  const cartItems = useCartStore((state) => state.cartItems[cartKey] ?? NO_LINES)
  const { addToCart, updateQuantity, replaceLine, clearCart } = useCartStore.getState()
  const [reviewOpen, setReviewOpen] = useState(false)
  const [comboPromotionId, setComboPromotionId] = useState<string | null>(null)
  const [editingLineId, setEditingLineId] = useState<string | null>(null)
  const [note, setNote] = useState(order?.notes ?? "")
  const [sending, setSending] = useState(false)
  const [shortages, setShortages] = useState<StockShortage[] | null>(null)

  const menuTree = useMenuTree()
  const { data: promotionsToday } = usePromotionsToday("takeaway")
  const sentLines: readonly OrderItem[] = order?.items ?? NO_LINES
  const { result: pricingResult } = usePricingPreview({
    channel: "takeaway",
    orderId: order?.id,
    orderVersion: sentLines.map((line) => `${line.id}:${line.quantity}`).join(","),
    cart: cartItems,
  })

  const menuDishes = useMemo(
    () => new Map((menuTree.categories ?? []).flatMap((category) => category.dishes).map((dish) => [dish.id, dish])),
    [menuTree.categories],
  )
  const preview = pricingResult?.preview
  const previewLineIds = pricingResult?.lineIds ?? []
  const discountRows = draftDiscounts(preview, previewLineIds)
  const sentPreviewRows = sentPreviewDiscounts(preview)
  // A combo the preview has not priced yet shows its own saving (Σ list − combo price).
  const localComboRows = (line: (typeof cartItems)[number]): DiscountRow[] =>
    isComboLine(line) && line.combo.listPrice > line.combo.comboPrice
      ? [{ label: line.name, amount: (line.combo.listPrice - line.combo.comboPrice) * line.quantity }]
      : []
  const newDiscounts = (lineId: string): DiscountRow[] => {
    const line = cartItems.find((entry) => entry.id === lineId)
    if (!line) return []
    return previewLineIds.includes(lineId) ? (discountRows.get(lineId) ?? []) : localComboRows(line)
  }
  // Sent lines keep the discounts fixed when they were sent ("fijado HH:MM"), as on a table.
  const sentDiscounts = (lineId: string): DiscountRow[] => {
    const line = sentLines.find((entry) => entry.id === lineId) as ApiOrderItem | undefined
    if (!line) return []
    const fixedAt = clockTime(line.addedAt)
    if (line.discounts?.length) {
      return line.discounts.map((discount) => ({
        label: discount.label,
        amount: discount.amount,
        fixedAt: discount.kind === "promotion_item" || discount.kind === "combo" ? fixedAt : null,
      }))
    }
    return (sentPreviewRows.get(lineId) ?? []).map((row) => ({ ...row, fixedAt }))
  }
  const sum = (rows: readonly DiscountRow[]) => rows.reduce((total, row) => total + row.amount, 0)
  const localSavings =
    sentLines.reduce((total, line) => total + sum(sentDiscounts(line.id)), 0) +
    cartItems.reduce((total, line) => total + sum(localComboRows(line)), 0)
  const total = preview ? preview.netSubtotal : lineTotal(sentLines) + lineTotal(cartItems) - localSavings
  const count = lineCount(cartItems)
  const missingUnits = preview?.hints.find((hint) => hint.kind === "missing_units")
  const sendWarning = windowWarning(promotionsToday, menuTree.categories, cartItems)

  const handleAdd = (item: StepPickerItem): (() => void) | void => {
    const { dish, quantity, comments, modifiers } = item
    const added = {
      id: dish.id,
      name: dish.name,
      price: item.unitPrice ?? dish.price + modifiersExtra(modifiers),
      quantity,
      categoryId: dish.categoryId ?? "",
      image: dish.imageUrl ?? "",
      comments,
      ...(modifiers?.length ? { modifiers } : {}),
      promotionId: dish.promotionId,
      promotionName: dish.promotionName,
    }
    addToCart(cartKey, added)
    const key = cartLineKey(added)
    const findLine = () =>
      useCartStore
        .getState()
        .getCartByTable(cartKey)
        .find((entry) => cartLineKey(entry) === key)
    const quantityAfterAdd = findLine()?.quantity
    return () => {
      const line = findLine()
      if (line && line.quantity === quantityAfterAdd) updateQuantity(cartKey, line.id, line.quantity - quantity)
    }
  }
  const handleQuickAdd = ({ dish, category }: QuickAdd) => {
    handleAdd({ dish, category, quantity: 1 })
    toast({ title: `+1 ${dish.name}` })
  }
  const changeQuantity = (lineId: string, change: number) => {
    const line = cartItems.find((entry) => entry.id === lineId)
    if (line) updateQuantity(cartKey, lineId, line.quantity + change)
  }
  const removeLine = (lineId: string) => {
    const before = useCartStore.getState().getCartByTable(cartKey)
    const index = before.findIndex((entry) => entry.id === lineId)
    if (index === -1) return
    const removed = before[index]
    updateQuantity(cartKey, lineId, 0)
    toast({
      title: `Quitaste ${removed.quantity}× ${removed.name}`,
      action: (
        <ToastAction
          altText="Deshacer"
          className="min-h-11 px-4"
          onClick={() =>
            useCartStore.setState((state) => {
              const cart = [...(state.cartItems[cartKey] ?? [])]
              cart.splice(Math.min(index, cart.length), 0, removed)
              return { cartItems: { ...state.cartItems, [cartKey]: cart } }
            })
          }
        >
          Deshacer
        </ToastAction>
      ),
    })
  }

  const editingLine = editingLineId ? (cartItems.find((entry) => entry.id === editingLineId) ?? null) : null
  const editingDishId = editingLine ? dishIdFromCartItemId(editingLine.id) : null
  const editingDish = editingDishId ? (menuDishes.get(editingDishId) ?? null) : null
  const saveEditedLine = ({ modifiers, quantity, note: comments, unitPrice }: ModifierSheetResult) => {
    if (!editingLine) return
    replaceLine(cartKey, editingLine.id, { ...editingLine, price: unitPrice, quantity, comments: comments || undefined, modifiers })
    setEditingLineId(null)
  }
  const editOptions = (lineId: string) => {
    const line = cartItems.find((entry) => entry.id === lineId)
    const dishId = line ? dishIdFromCartItemId(line.id) : null
    if (dishId && menuDishes.has(dishId)) setEditingLineId(lineId)
    else toast({ title: "El plato ya no está en el menú", description: "Quítalo y agrega otro.", variant: "destructive" })
  }

  const combos = comboTiles(promotionsToday)
  const comboTileList = combos.map((tile) => ({
    id: `combo-${tile.promotion.id}`,
    name: tile.promotion.name,
    meta: tile.enabled ? tile.promotion.comboGroups.map((group) => group.name).join(" + ") : scheduleShort(tile.promotion),
    tag: tile.enabled
      ? {
          promotionId: tile.promotion.id,
          text: tile.endsAt ? `Combo · hasta ${tile.endsAt}` : "Combo",
          tone: tile.minutesLeft != null && tile.minutesLeft <= 10 ? ("ending" as const) : ("on" as const),
        }
      : tile.startsAt
        ? { promotionId: tile.promotion.id, text: `Combo desde ${tile.startsAt}`, tone: "later" as const }
        : null,
    disabled: !tile.enabled,
    onSelect: () => {
      if (tile.enabled) {
        setReviewOpen(false)
        setComboPromotionId(tile.promotion.id)
      } else toast({ title: sellsText(tile.promotion) })
    },
  }))
  const buildingCombo = comboPromotionId ? (combos.find((tile) => tile.enabled && tile.promotion.id === comboPromotionId) ?? null) : null
  const addCombo = (combo: CartCombo) => {
    if (!buildingCombo) return
    useCartStore.getState().addCombo(cartKey, {
      name: buildingCombo.promotion.name,
      price: combo.listPrice,
      quantity: 1,
      categoryId: "",
      image: "",
      combo,
    })
    const saving = comboSavingText(combo.listPrice, combo.comboPrice).saving
    toast({ title: `${buildingCombo.promotion.name} agregado${saving ? ` · ${saving}` : ""}` })
    setComboPromotionId(null)
  }

  const pricing: OrderPricing = {
    newDiscounts,
    sentDiscounts,
    total,
    savings: preview ? preview.totalDiscounts : localSavings,
    notices:
      missingUnits || sendWarning ? (
        <div className="grid gap-2">
          {missingUnits && (
            <PromotionNudge
              message={missingUnits.message}
              adds={quickAdds(missingUnits, promotionsToday, menuTree.categories, cartItems)}
              onQuickAdd={handleQuickAdd}
            />
          )}
          {sendWarning && <WindowEndingWarning warning={sendWarning} />}
        </div>
      ) : undefined,
  }
  const tags = {
    category: (category: Parameters<typeof categoryTag>[1]) => categoryTag(promotionsToday, category),
    subcategory: (category: Parameters<typeof categoryTag>[1], subcategoryId: string | null) =>
      subcategoryTag(promotionsToday, category, subcategoryId),
    dish: (dish: Parameters<typeof dishTag>[1]) => dishTag(promotionsToday, dish),
  }

  const close = () => {
    clearCart(cartKey)
    onClose()
  }

  // A 409 `Price changed`: the dish lines take the server's prices before sending again.
  const reprice = (prices: readonly { dishId: string; price: number }[], lines: readonly { index: number; unitPrice: number }[] = []) => {
    const priceByDish = new Map(prices.map((entry) => [entry.dishId, entry.price]))
    const priceByIndex = new Map(lines.map((entry) => [entry.index, entry.unitPrice]))
    let dishIndex = 0
    useCartStore.setState((state) => ({
      cartItems: {
        ...state.cartItems,
        [cartKey]: (state.cartItems[cartKey] ?? []).map((item) => {
          if (isComboLine(item)) return item
          const index = dishIndex++
          const dishPrice = priceByDish.get(dishIdFromCartItemId(item.id) ?? "")
          const price = priceByIndex.get(index) ?? (dishPrice === undefined ? undefined : dishPrice + modifiersExtra(item.modifiers))
          return price === undefined || price === item.price ? item : { ...item, price }
        }),
      },
    }))
    void queryClient.invalidateQueries({ queryKey: ["menu"] }).catch(() => undefined)
  }

  const send = async (force = false) => {
    if (cartItems.length === 0 || sending) return
    setSending(true)
    setShortages(null)
    try {
      const combosBody = combosFromCart(cartItems)
      const trimmedNote = note.trim()
      const lines = orderItemsFromCart(cartItems)
      const created = order
        ? await addItemsToOrder(order.id, lines, {
            ...(force ? { force: true } : {}),
            ...(combosBody.length ? { combos: combosBody } : {}),
            ...(trimmedNote !== (order.notes ?? "") ? { notes: trimmedNote || null } : {}),
          })
        : await createOrder({
        orderType: "takeaway",
        customerName: customer.name,
        ...(customer.phone ? { customerPhone: customer.phone } : {}),
        items: lines,
        ...(combosBody.length ? { combos: combosBody } : {}),
        ...(trimmedNote ? { notes: trimmedNote } : {}),
        ...(force ? { force: true } : {}),
      })
      if (inventoryControlEnabled) {
        for (const queryKey of [...invalidationsFor({ type: "consumeOrder" }), [...MENU_TREE_KEY]]) {
          void queryClient.invalidateQueries({ queryKey }).catch(() => undefined)
        }
      }
      // The API prints "PARA LLEVAR · <nombre>" and the sender on the comanda; a combo goes as its dishes.
      const kitchenItems = cartItems.flatMap<unknown>((item) =>
        isComboLine(item)
          ? item.combo.choices.map((choice) => ({ id: choice.dishId, dishId: choice.dishId, name: choice.name, quantity: item.quantity }))
          : [item],
      )
      if (printingEnabled) void sendCommand({ orderId: created.id, items: kitchenItems })
      clearCart(cartKey)
      toast({
        title: order ? "Productos agregados" : "Pedido para llevar enviado",
        description: `${created.orderNumber ? `#${created.orderNumber} · ` : ""}${customer.name} ha sido enviado a cocina.`,
      })
      onSent(created)
    } catch (error) {
      const conflict = orderConflictOf(error)
      if (conflict?.kind === "shortage") {
        setShortages(conflict.shortages)
      } else if (conflict?.kind === "priceChanged") {
        reprice(conflict.prices, conflict.lines)
        toast({ title: "Precios actualizados", description: "Algunos precios cambiaron. Revise el pedido y envíe de nuevo.", variant: "destructive" })
      } else {
        log.error("Error al enviar el pedido para llevar:", { error: String(error) })
        const shown = error instanceof ApiError && error.status === 422
        toast({
          title: "Error",
          description: shown ? (error as ApiError).message : "No se pudo enviar el pedido. Intente nuevamente.",
          variant: "destructive",
        })
      }
    } finally {
      setSending(false)
    }
  }

  const title = `Para llevar · ${customer.name}`
  return (
    <div className="fixed inset-0 z-40 h-[100dvh]">
      <StepPicker
        menu={menuTree.categories}
        isError={menuTree.isError}
        onRetry={menuTree.refetch}
        onAdd={handleAdd}
        onExit={close}
        exitLabel="Salir"
        banner={promotionsToday ? <PromotionStrip state={stripState(promotionsToday)} /> : undefined}
        tags={tags}
        extraTiles={comboTileList}
        header={
          <>
            <Button variant="ghost" size="icon" className="h-11 w-11 flex-none" aria-label="Salir sin enviar" onClick={close}>
              <ArrowLeft className="h-5 w-5" aria-hidden />
            </Button>
            <span
              aria-hidden
              className="grid h-11 w-11 flex-none place-items-center rounded-[14px] border-[1.5px] border-status-kitchen-line bg-status-kitchen-bg text-status-kitchen-fg"
            >
              <ShoppingBag className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold">{title}</p>
              {customer.phone && <p className="mt-0.5 truncate text-[12.5px] text-muted-fg">Tel. {customer.phone}</p>}
            </div>
            {promotionsToday && <PromotionsSheet today={promotionsToday} />}
          </>
        }
        summary={
          <button
            type="button"
            onClick={() => {
              setComboPromotionId(null)
              setReviewOpen((open) => !open)
            }}
            aria-label={`${title}, ${count} productos, ${formatCurrency(total)}. ${reviewOpen ? "Volver a los pasos" : "Ver pedido"}`}
            className="flex min-h-[52px] w-full min-w-0 items-center gap-2.5 rounded-2xl border border-line bg-surface-2 px-3 py-1.5 text-left focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus md:min-h-[60px]"
          >
            <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1 text-[14.5px] leading-snug md:flex-col md:gap-0">
              <span className="whitespace-nowrap">
                Para llevar · <b className="font-semibold tabular-nums">{count} productos</b>
                <span className="md:hidden"> ·</span>
              </span>
              <b className="whitespace-nowrap font-semibold tabular-nums">{formatCurrency(total)}</b>
            </span>
            <span className="inline-flex flex-none items-center gap-1 whitespace-nowrap text-sm font-semibold text-brand-strong">
              {reviewOpen ? "Ocultar" : "Ver pedido"}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </span>
          </button>
        }
        primaryAction={
          <Button onClick={() => void send()} disabled={count === 0 || sending} className="text-base">
            <Send className="mr-1.5 h-[18px] w-[18px]" aria-hidden />
            Enviar a cocina ({count})
          </Button>
        }
        aside={
          <OrderColumn
            title={title}
            newLines={cartItems}
            sentLines={sentLines}
            pricing={pricing}
            onReview={() => {
              setComboPromotionId(null)
              setReviewOpen(true)
            }}
          />
        }
        overlay={
          reviewOpen ? (
            <OrderReview
              title={title}
              note={note}
              onNoteChange={setNote}
              newLines={cartItems}
              sentLines={sentLines}
              onChangeQuantity={changeQuantity}
              onRemove={removeLine}
              onEditOptions={editOptions}
              onContinue={() => setReviewOpen(false)}
              pricing={pricing}
            />
          ) : buildingCombo ? (
            <ComboBuilder
              key={buildingCombo.promotion.id}
              promotion={buildingCombo.promotion}
              dishes={menuDishes}
              endsAt={buildingCombo.endsAt}
              onAdd={addCombo}
            />
          ) : undefined
        }
        onCloseOverlay={() => {
          setReviewOpen(false)
          setComboPromotionId(null)
        }}
      />
      <ModifierSheet
        dish={editingLine && editingDish ? editingDish : null}
        initial={
          editingLine
            ? { selection: selectionOf(editingLine.modifiers ?? []), quantity: editingLine.quantity, note: editingLine.comments ?? "" }
            : undefined
        }
        onClose={() => setEditingLineId(null)}
        onSubmit={saveEditedLine}
      />
      <Dialog open={shortages !== null} onOpenChange={(open) => !open && setShortages(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Advertencia de Inventario</DialogTitle>
            <DialogDescription>No hay suficiente stock de ingredientes para completar este pedido:</DialogDescription>
          </DialogHeader>
          <ul className="list-inside list-disc space-y-1 text-sm">
            {(shortages ?? []).map((shortage) => (
              <li key={shortage.ingredientId}>
                {shortage.name}: hay {shortage.available} {shortage.unit}, se requieren {shortage.required} {shortage.unit}
              </li>
            ))}
          </ul>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" className="min-h-11" onClick={() => setShortages(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" className="min-h-11" onClick={() => void send(true)}>
              Enviar de todos modos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
