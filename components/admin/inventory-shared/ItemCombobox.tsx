"use client"

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { formatQuantity } from "@/lib/inventory/units"
import type { InventoryItem } from "@/lib/supabase/inventory/types"
import { cn } from "@/lib/utils"

export type ComboboxItem = Pick<InventoryItem, "id" | "name" | "sku" | "unit" | "kind" | "stock">

export interface ItemComboboxProps<T extends ComboboxItem = ComboboxItem> {
  items: T[]
  onSelect: (item: T) => void
  excludeIds?: readonly string[]
  /** Reason an item cannot be picked (shown next to it); null when allowed. */
  disabledReason?: (item: T) => string | null
  placeholder?: string
  label?: string
  /** Offers "Crear preparación «query»" when no item name matches exactly. */
  onCreate?: (query: string) => void
  autoFocus?: boolean
  /** Focus the search with `/` from anywhere outside a text field. */
  hotkey?: boolean
  maxResults?: number
  className?: string
}

export interface ItemComboboxHandle {
  focus: () => void
}

const fold = (text: string) =>
  text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()

const isTextField = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))

function ItemComboboxInner<T extends ComboboxItem>(
  {
    items,
    onSelect,
    excludeIds,
    disabledReason,
    placeholder = "Buscar artículo…",
    label = "Buscar artículo",
    onCreate,
    autoFocus = false,
    hotkey = false,
    maxResults = 40,
    className,
  }: ItemComboboxProps<T>,
  ref: React.ForwardedRef<ItemComboboxHandle>,
) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), [])

  useEffect(() => {
    if (!hotkey) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || isTextField(event.target)) return
      event.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [hotkey])

  const needle = fold(query)
  const results = useMemo(() => {
    const excluded = new Set(excludeIds)
    return items
      .filter((item) => !excluded.has(item.id))
      .filter((item) => !needle || fold(item.name).includes(needle) || fold(item.sku).includes(needle))
      .sort((a, b) => Number(fold(b.name).startsWith(needle)) - Number(fold(a.name).startsWith(needle)))
      .slice(0, maxResults)
  }, [items, excludeIds, needle, maxResults])

  const exactMatch = items.some((item) => fold(item.name) === needle)
  const canCreate = !!onCreate && needle !== "" && !exactMatch

  const pick = (item: T) => {
    onSelect(item)
    setQuery("")
    setOpen(false)
  }

  return (
    <Command
      shouldFilter={false}
      loop
      label={label}
      className={cn("relative overflow-visible rounded-md border bg-background", className)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && (open || query)) {
          event.stopPropagation()
          setQuery("")
          setOpen(false)
        }
      }}
    >
      <CommandInput
        ref={inputRef}
        value={query}
        onValueChange={(next) => {
          setQuery(next)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        placeholder={hotkey ? `${placeholder} (/)` : placeholder}
        autoFocus={autoFocus}
      />
      {open && (
        <CommandList
          aria-label="Resultados"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 rounded-md border bg-popover text-popover-foreground shadow-md"
          onMouseDown={(event) => event.preventDefault()}
        >
          {!canCreate && <CommandEmpty>Sin resultados</CommandEmpty>}
          {results.length > 0 && (
            <CommandGroup heading="Artículos">
              {results.map((item) => {
                const reason = disabledReason?.(item) ?? null
                return (
                  <CommandItem
                    key={item.id}
                    value={item.id}
                    disabled={reason !== null}
                    onSelect={() => pick(item)}
                    title={reason ?? undefined}
                    className="flex items-center gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{item.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {item.sku} · {item.unit}
                        {reason && <span className="ml-1 text-destructive">· {reason}</span>}
                      </p>
                    </div>
                    <Badge variant={item.kind === "prep" ? "secondary" : "outline"} className="shrink-0 font-normal">
                      {item.kind === "prep" ? "Preparación" : "Materia prima"}
                    </Badge>
                    <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:inline">
                      {formatQuantity(item.stock, item.unit, { autoScale: true })}
                    </span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          )}
          {canCreate && (
            <CommandGroup heading="Nueva">
              <CommandItem
                value={`__create__${query}`}
                onSelect={() => {
                  onCreate?.(query.trim())
                  setQuery("")
                  setOpen(false)
                }}
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                Crear preparación «{query.trim()}»
              </CommandItem>
            </CommandGroup>
          )}
        </CommandList>
      )}
    </Command>
  )
}

/** Keyboard-first search over inventory items: type, ↑/↓, Enter. */
export const ItemCombobox = forwardRef(ItemComboboxInner) as <T extends ComboboxItem = ComboboxItem>(
  props: ItemComboboxProps<T> & { ref?: React.Ref<ItemComboboxHandle> },
) => ReturnType<typeof ItemComboboxInner>
