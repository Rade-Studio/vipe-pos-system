import type { DishModifierGroupDto } from "@/lib/api/catalog"
import { formatCurrency } from "@/utils/helpers"
import type { OrderItemModifier } from "@/types"

/**
 * Modifier rules of the waiter sheet (F7 T3, S3): the client mirror of
 * `private.resolve_line_modifiers` so the sheet can block "Agregar" and show
 * the line price. The server still checks and prices every line (L4, L5).
 */

/** Chosen option ids per group id. */
export type ModifierSelection = Readonly<Record<string, readonly string[]>>

/** One chosen option of a line, the same shape as `OrderItem.modifiers`. */
export type LineModifier = OrderItemModifier

export const isSingleChoice = (group: DishModifierGroupDto) => group.maxSelect === 1

export function ruleText(group: DishModifierGroupDto): string {
  const { minSelect: min, maxSelect: max } = group
  if (min >= 1) {
    if (max === min) return `Obligatorio · elige ${min}`
    return max === null ? `Obligatorio · al menos ${min}` : `Obligatorio · de ${min} a ${max}`
  }
  return max === null ? "Opcional · sin límite" : `Opcional · hasta ${max}`
}

export function counterText(group: DishModifierGroupDto, count: number): string {
  if (isSingleChoice(group)) return count > 0 ? "Listo" : group.minSelect >= 1 ? "Falta elegir" : ""
  if (group.maxSelect !== null) return `${count} de ${group.maxSelect}`
  return count === 0 ? "" : `${count} ${count === 1 ? "elegida" : "elegidas"}`
}

const picked = (selection: ModifierSelection, groupId: string) => selection[groupId] ?? []

export function toggleOption(
  group: DishModifierGroupDto,
  selection: ModifierSelection,
  optionId: string,
): { selection: ModifierSelection; refused: "max" | null } {
  const current = picked(selection, group.id)
  const on = current.includes(optionId)
  let next: readonly string[]
  if (isSingleChoice(group)) {
    if (on && group.minSelect >= 1) return { selection, refused: null }
    next = on ? [] : [optionId]
  } else if (on) {
    next = current.filter((id) => id !== optionId)
  } else {
    if (group.maxSelect !== null && current.length >= group.maxSelect) return { selection, refused: "max" }
    next = [...current, optionId]
  }
  return { selection: { ...selection, [group.id]: next }, refused: null }
}

/** The groups still short of their minimum. */
export const missingGroups = (groups: readonly DishModifierGroupDto[], selection: ModifierSelection) =>
  groups.filter((group) => picked(selection, group.id).length < group.minSelect)

/** "Falta: Término de la carne", or null when every rule holds. */
export const blockReason = (missing: readonly DishModifierGroupDto[]): string | null =>
  missing.length === 0 ? null : `Falta: ${missing.map((group) => group.name).join(", ")}`

/** The chosen options in the dish's group order, then the group's option order. */
export function chosenModifiers(groups: readonly DishModifierGroupDto[], selection: ModifierSelection): LineModifier[] {
  return groups.flatMap((group) => {
    const ids = picked(selection, group.id)
    return group.options
      .filter((option) => ids.includes(option.id))
      .map((option) => ({ groupId: group.id, groupName: group.name, optionId: option.id, name: option.name, price: option.price }))
  })
}

export const modifiersExtra = (modifiers: readonly Pick<LineModifier, "price">[] | undefined) =>
  (modifiers ?? []).reduce((sum, modifier) => sum + modifier.price, 0)

export function selectionOf(modifiers: readonly Pick<LineModifier, "groupId" | "optionId">[]): ModifierSelection {
  const selection: Record<string, string[]> = {}
  for (const { groupId, optionId } of modifiers) (selection[groupId] ??= []).push(optionId)
  return selection
}

/** "Hamburguesa $22.000 + $7.000 = $29.000 c/u". */
export function priceSummary(dishName: string, base: number, extra: number): string {
  const short = dishName.trim().split(/\s+/)[0] ?? dishName
  return `${short} ${formatCurrency(base)} + ${formatCurrency(extra)} = ${formatCurrency(base + extra)} c/u`
}

/** Line identity: two lines merge only with the same dish, options and note. */
export const lineKey = (dishId: string, optionIds: readonly string[], note: string | null | undefined) =>
  `${dishId}|${[...optionIds].sort().join(",")}|${(note ?? "").trim()}`

/** "+ Queso cheddar" for a priced option, "Término: Medio" for a $0 one ("Sin cebolla" stays as is). */
export function modifierLabel(modifier: Pick<LineModifier, "groupName" | "name" | "price">): string {
  if (modifier.price > 0) return `+ ${modifier.name}`
  const group = modifier.groupName.trim()
  return modifier.name.toLowerCase().startsWith(group.toLowerCase()) ? modifier.name : `${group}: ${modifier.name}`
}
