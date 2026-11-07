import type { StationColor } from "@/lib/api/stations"

/**
 * Station colour tokens (design/system.md status palette). Literal class
 * names so Tailwind keeps them; the label names the colour for the picker.
 */
export const STATION_STYLE: Record<StationColor, { label: string; dot: string; chip: string }> = {
  kitchen: {
    label: "Naranja",
    dot: "bg-status-kitchen-line",
    chip: "border-status-kitchen-line bg-status-kitchen-bg text-status-kitchen-fg",
  },
  served: {
    label: "Azul",
    dot: "bg-status-served-line",
    chip: "border-status-served-line bg-status-served-bg text-status-served-fg",
  },
  occupied: {
    label: "Violeta",
    dot: "bg-status-occupied-line",
    chip: "border-status-occupied-line bg-status-occupied-bg text-status-occupied-fg",
  },
  free: {
    label: "Verde",
    dot: "bg-status-free-line",
    chip: "border-status-free-line bg-status-free-bg text-status-free-fg",
  },
  reserved: {
    label: "Gris",
    dot: "bg-status-reserved-line",
    chip: "border-status-reserved-line bg-status-reserved-bg text-status-reserved-fg",
  },
}

export const STATION_COLORS = Object.keys(STATION_STYLE) as StationColor[]

/** Shared 44 px native select, styled like the design's `.sel`. */
export const SELECT_CLASS =
  "min-h-11 w-full appearance-none rounded-full border border-line-strong bg-card bg-[length:5px_5px,5px_5px] bg-[position:calc(100%-18px)_50%,calc(100%-13px)_50%] bg-no-repeat pl-3.5 pr-9 text-sm text-fg [background-image:linear-gradient(45deg,transparent_50%,currentColor_50%),linear-gradient(135deg,currentColor_50%,transparent_50%)] focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"

export const platos = (count: number) => `${count} ${count === 1 ? "plato" : "platos"}`
