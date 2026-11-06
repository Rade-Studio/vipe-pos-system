import { TILE_NAME_LIMIT, tileNameHint } from "@/lib/admin/catalog"
import { cn } from "@/lib/utils"

/** Live "n/22" under a category or subcategory name; above 22 a soft warning, never a block (L19 e). */
export function NameLengthHint({ id, value }: { id?: string; value: string }) {
  const { count, over } = tileNameHint(value)
  return (
    <p id={id} className={cn("flex min-w-0 flex-wrap justify-between gap-x-2 text-xs", over ? "text-status-warning-fg" : "text-muted-fg")}>
      <span className="min-w-0">{over && `Más de ${TILE_NAME_LIMIT} caracteres: puede cortarse en el botón del mesero.`}</span>
      <span className="shrink-0 tabular-nums">
        {count}/{TILE_NAME_LIMIT}
      </span>
    </p>
  )
}
