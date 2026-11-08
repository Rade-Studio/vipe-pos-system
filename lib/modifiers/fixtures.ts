import type { DishModifierGroupDto } from "@/lib/api/catalog"

/** A dish modifier group for tests; options are [id, name, price]. */
export function modifierGroup(
  overrides: Partial<Omit<DishModifierGroupDto, "options">> & { options?: [string, string, number][] } = {},
): DishModifierGroupDto {
  const { options = [], ...rest } = overrides
  const id = rest.id ?? "g-0"
  const minSelect = rest.minSelect ?? 0
  return {
    id,
    name: "Grupo",
    maxSelect: null,
    ...rest,
    minSelect,
    required: minSelect >= 1,
    options: options.map(([optionId, name, price], index) => ({
      id: optionId,
      groupId: id,
      name,
      price,
      ingredientId: null,
      ingredientQty: null,
      sortOrder: index,
      isActive: true,
    })),
  }
}
