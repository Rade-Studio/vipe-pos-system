"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, Pencil, Plus, Trash } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
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
import { useToast } from "@/hooks/use-toast"
import { log } from "@/lib/log"
import * as subcategoriesApi from "@/lib/api/subcategories"
import type { SubcategoryDto } from "@/lib/api/subcategories"
import { catalogKeys, errorMessage, invalidateCatalogReaders, moveItem, type AdminCategoryNode } from "@/lib/admin/catalog"
import { cn } from "@/lib/utils"
import { plural } from "./WaiterPreview"

/** The API trims and accepts 1..40 characters. */
const MAX_NAME = 40

const iconButton =
  "h-11 w-11 shrink-0 focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:ring-0"

/** Subcategories of one category: the waiter's step 2, in this order. */
export function SubcategoryManager({ node, inputId }: { node: AdminCategoryNode; inputId: string }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [newName, setNewName] = useState("")
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState<SubcategoryDto | null>(null)
  const [busy, setBusy] = useState(false)
  const { category } = node
  const subcategories = node.subcategories.map((s) => s.subcategory)

  const refresh = () => invalidateCatalogReaders(queryClient, catalogKeys.subcategories)

  /** Runs one write; the API's Spanish message (409/422) is what the admin reads. */
  const run = async (action: string, write: () => Promise<unknown>, done?: string) => {
    setBusy(true)
    try {
      await write()
      if (done) toast({ title: done })
      return true
    } catch (error) {
      log.error(`Error ${action} subcategory:`, { error: String(error) })
      toast({ variant: "destructive", title: "Error", description: errorMessage(error) })
      return false
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  const add = async () => {
    const name = newName.trim()
    if (!name) return
    if (await run("creating", () => subcategoriesApi.create({ categoryId: category.id, name }), `Subcategoría ${name} creada`)) {
      setNewName("")
    }
  }

  const move = (from: number, to: number) => {
    const next = moveItem(subcategories, from, to)
    if (!next) return
    void run("reordering", () => subcategoriesApi.reorder(category.id, next.map((s) => s.id)))
  }

  const rename = async () => {
    if (!renaming) return
    const name = renaming.name.trim()
    if (!name) return
    if (await run("renaming", () => subcategoriesApi.update(renaming.id, { name }), "Subcategoría renombrada")) setRenaming(null)
  }

  const remove = async () => {
    if (!deleting) return
    const target = deleting
    setDeleting(null)
    await run("deleting", () => subcategoriesApi.delete(target.id), `Subcategoría ${target.name} eliminada`)
  }

  return (
    <section aria-labelledby={`${inputId}-title`} className="min-w-0 space-y-3">
      <div>
        <h3 id={`${inputId}-title`} className="text-sm font-semibold">
          Subcategorías
        </h3>
        <p className="text-sm text-muted-fg">El paso 2 del mesero, en este orden. Las inactivas no se muestran.</p>
      </div>

      {subcategories.length > 0 && (
        <ol aria-label={`Editar subcategorías de ${category.name}`} className="grid gap-1.5">
          {node.subcategories.map(({ subcategory, dishes }, index) => (
            <li
              key={subcategory.id}
              className="flex min-w-0 flex-wrap items-center gap-1 rounded-xl border border-line bg-card py-1 pl-3 pr-1"
            >
              {renaming?.id === subcategory.id ? (
                <form
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-1 py-1"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void rename()
                  }}
                >
                  <Input
                    aria-label={`Nombre de ${subcategory.name}`}
                    value={renaming.name}
                    maxLength={MAX_NAME}
                    autoFocus
                    onChange={(event) => setRenaming({ id: subcategory.id, name: event.target.value })}
                    className="h-11 min-w-0 flex-1 basis-40"
                  />
                  <Button type="submit" className="min-h-11" disabled={busy || !renaming.name.trim()}>
                    Guardar
                  </Button>
                  <Button type="button" variant="ghost" className="min-h-11" onClick={() => setRenaming(null)}>
                    Cancelar
                  </Button>
                </form>
              ) : (
                <>
                  <span className="min-w-0 flex-1 basis-32 py-1">
                    <span className="block break-words text-sm font-medium [overflow-wrap:anywhere]">{subcategory.name}</span>
                    <span className="block text-xs text-muted-fg">
                      {plural(dishes.length, "plato", "platos")}
                      {!subcategory.active && " · Inactiva"}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className={iconButton}
                      aria-label={`Subir ${subcategory.name}`}
                      disabled={busy || index === 0}
                      onClick={() => move(index, index - 1)}
                    >
                      <ArrowUp className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className={iconButton}
                      aria-label={`Bajar ${subcategory.name}`}
                      disabled={busy || index === subcategories.length - 1}
                      onClick={() => move(index, index + 1)}
                    >
                      <ArrowDown className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className={iconButton}
                      aria-label={`Renombrar ${subcategory.name}`}
                      onClick={() => setRenaming({ id: subcategory.id, name: subcategory.name })}
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </Button>
                    <span className="grid h-11 w-14 place-items-center">
                      <Switch
                        aria-label={`${subcategory.name} activa`}
                        checked={subcategory.active}
                        disabled={busy}
                        onCheckedChange={(active) => void run("updating", () => subcategoriesApi.update(subcategory.id, { active }))}
                      />
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className={cn(iconButton, "text-status-danger-fg")}
                      aria-label={`Eliminar ${subcategory.name}`}
                      onClick={() => setDeleting(subcategory)}
                    >
                      <Trash className="h-4 w-4" aria-hidden />
                    </Button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ol>
      )}

      <form
        className="flex min-w-0 flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void add()
        }}
      >
        <div className="min-w-0 flex-1 basis-48 space-y-1">
          <Label htmlFor={inputId}>Nueva subcategoría</Label>
          <Input
            id={inputId}
            value={newName}
            maxLength={MAX_NAME}
            placeholder="Ej: Jugos naturales"
            onChange={(event) => setNewName(event.target.value)}
            className="h-11"
          />
        </div>
        <Button type="submit" variant="outline" className="min-h-11" disabled={busy || !newName.trim()}>
          <Plus className="mr-1 h-4 w-4" aria-hidden />
          Agregar subcategoría
        </Button>
      </form>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar la subcategoría {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Solo se puede eliminar sin platos: si tiene, muévelos antes a otra subcategoría o déjalos en la categoría.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
