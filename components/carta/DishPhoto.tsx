import Image from "next/image"
import { cn } from "@/lib/utils"

/**
 * A dish photo from `imageUrl` (rendered as the staff menu does, the public
 * bucket URL straight into next/image) or a neutral plate placeholder.
 */
export function DishPhoto({
  src,
  sizes,
  className,
  muted = false,
}: {
  src: string | null | undefined
  sizes: string
  className?: string
  muted?: boolean
}) {
  return (
    <div className={cn("relative overflow-hidden bg-surface-2", muted && "opacity-45 grayscale", className)}>
      {src ? (
        <Image src={src} alt="" fill sizes={sizes} className="object-cover" />
      ) : (
        <svg viewBox="0 0 96 96" aria-hidden="true" focusable="false" className="h-full w-full" preserveAspectRatio="xMidYMid slice">
          <circle cx="48" cy="51" r="36" className="fill-line" />
          <circle cx="48" cy="48" r="36" className="fill-surface" />
          <circle cx="48" cy="48" r="28" fill="none" className="stroke-line-strong" strokeWidth="2" />
        </svg>
      )}
    </div>
  )
}
