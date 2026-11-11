import type { TableShape } from "@/types"

/** Small outline of a tabletop shape for the palette and the inspector. */
export function ShapeIcon({ shape }: { shape: TableShape }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8}>
      {shape === "round" && <circle cx="12" cy="12" r="7" />}
      {shape === "square" && <rect x="5" y="5" width="14" height="14" rx="3" />}
      {shape === "rect" && <rect x="2.5" y="7" width="19" height="10" rx="3" />}
      {shape === "bar" && <rect x="2" y="9.5" width="20" height="5" rx="1" />}
    </svg>
  )
}
