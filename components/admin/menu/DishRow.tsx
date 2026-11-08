"use client"

import Image from "next/image"
import { BookOpen, Check, Edit, Layers, MoreHorizontal, Trash } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { DishDto } from "@/lib/api/catalog"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/utils/helpers"

const focusRing =
  "focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:ring-0"
const chip = "inline-flex min-h-6 items-center gap-1 whitespace-nowrap rounded-pill border px-2 text-xs font-medium"
const iconButton = cn("h-11 w-11 min-h-11 shrink-0", focusRing)
const menuItem = "min-h-11 gap-2"

interface DishRowProps {
  dish: DishDto
  /** "Categoría › Subcategoría", or the subcategory alone inside a category filter. */
  path: string
  soldOut: boolean
  onFormula: () => void
  onEdit: () => void
  onDelete: () => void
}

/** One dish of the Platos tab: a dense row from 640 px, a card with a ⋯ menu below. */
export function DishRow({ dish, path, soldOut, onFormula, onEdit, onDelete }: DishRowProps) {
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
      <span
        aria-hidden
        className="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-surface-2 text-base font-semibold text-fg-2"
      >
        {dish.imageUrl ? <Image src={dish.imageUrl} alt="" fill sizes="44px" className="object-cover" /> : dish.name.charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1 basis-40">
        <b data-dish-name className="block break-words text-[15px] font-semibold leading-tight [overflow-wrap:anywhere]">
          {dish.name}
        </b>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-fg">
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{path}</span>
          {dish.modifierGroups.length > 0 && (
            <span className={cn(chip, "border-[var(--accent-line)] bg-brand-tint text-fg")} title={dish.modifierGroups.map((g) => g.name).join(", ")}>
              <Layers className="h-3 w-3" aria-hidden />
              Con opciones
            </span>
          )}
        </span>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 max-sm:order-last max-sm:w-full max-sm:pl-14">
        <span className="min-w-[5.5rem] text-right text-sm font-semibold tabular-nums max-sm:min-w-0 max-sm:text-left">
          {formatCurrency(dish.price)}
        </span>
        {dish.active ? (
          <span className={cn(chip, "border-status-ok-line bg-status-ok-bg text-status-ok-fg")}>
            <Check className="h-3 w-3" aria-hidden />
            Activo
          </span>
        ) : (
          <span className={cn(chip, "border-line bg-surface-2 text-muted-fg")}>Inactivo</span>
        )}
        {soldOut && (
          <span className={cn(chip, "border-status-warning-line bg-status-warning-bg text-status-warning-fg")} title="Sin stock según inventario">
            Agotado
          </span>
        )}
      </div>
      <div className="hidden shrink-0 items-center gap-0.5 sm:flex">
        <Button type="button" variant="ghost" size="icon" className={iconButton} aria-label={`Fórmula de ${dish.name}`} title="Fórmula" onClick={onFormula}>
          <BookOpen className="h-4 w-4" aria-hidden />
        </Button>
        <Button type="button" variant="ghost" size="icon" className={iconButton} aria-label={`Editar ${dish.name}`} title="Editar" onClick={onEdit}>
          <Edit className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(iconButton, "text-status-danger-fg")}
          aria-label={`Eliminar ${dish.name}`}
          title="Eliminar"
          onClick={onDelete}
        >
          <Trash className="h-4 w-4" aria-hidden />
        </Button>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" className={cn(iconButton, "sm:hidden")} aria-label={`Acciones de ${dish.name}`}>
            <MoreHorizontal className="h-5 w-5" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem className={menuItem} onSelect={onEdit}>
            <Edit className="h-4 w-4" aria-hidden />
            Editar
          </DropdownMenuItem>
          <DropdownMenuItem className={menuItem} onSelect={onFormula}>
            <BookOpen className="h-4 w-4" aria-hidden />
            Fórmula
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className={cn(menuItem, "text-status-danger-fg")} onSelect={onDelete}>
            <Trash className="h-4 w-4" aria-hidden />
            Eliminar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}
