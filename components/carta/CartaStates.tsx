import { Skeleton } from "@/components/ui/skeleton"
import type { CartaFailure } from "@/lib/carta/api"
import type { CartaStrings } from "@/lib/carta/i18n"
import { cn } from "@/lib/utils"
import { FOCUS, GHOST } from "./styles"

const SHELL = "mx-auto min-h-dvh w-full max-w-[480px] overflow-x-hidden bg-canvas text-fg"

export function CartaSkeleton({ t }: { t: CartaStrings }) {
  return (
    <div role="status" aria-label={t.loading} className={SHELL}>
      <Skeleton className="h-32 rounded-none" />
      <div className="-mt-9 grid gap-3 px-[18px]">
        <Skeleton className="h-[72px] w-[72px] rounded-[22px] border-4 border-canvas" />
        <Skeleton className="h-7 w-3/5" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="mt-4 h-[52px] w-full rounded-xl" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_96px] gap-3.5 py-3.5">
            <div className="grid content-start gap-2">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-1/3" />
            </div>
            <Skeleton className="h-24 w-24 rounded-[20px]" />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Not found (unknown slug, unpublished carta, old table QR), rate limited or
 * network error. The 404 says nothing about any restaurant.
 */
export function CartaFailureView({ failure, t, onRetry }: { failure: CartaFailure; t: CartaStrings; onRetry: () => void }) {
  const [title, hint] =
    failure === "not_found"
      ? [t.notFound, t.notFoundHint]
      : failure === "rate_limited"
        ? [t.rateLimited, null]
        : [t.error, t.errorHint]
  return (
    <main className={cn(SHELL, "grid content-center justify-items-center gap-3 px-6 text-center")}>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {hint && <p className="text-sm text-muted-fg">{hint}</p>}
      {failure !== "not_found" && (
        <button type="button" onClick={onRetry} className={cn(GHOST, "mt-2", FOCUS)}>
          {t.retry}
        </button>
      )}
    </main>
  )
}
