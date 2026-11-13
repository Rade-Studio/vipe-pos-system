"use client"

import { useId, useState } from "react"
import type { CartaStrings } from "@/lib/carta/i18n"
import { cn } from "@/lib/utils"
import { BRAND_FILL, BRAND_TEXT, CTA, FOCUS, GHOST } from "./styles"

/**
 * "Reseña al final" (S14, L5): five stars and, for every rating, the same
 * invitation to Google (no review gating: Google's policy), plus an optional
 * private comment for the restaurant.
 */
export function ReviewCard({
  t,
  title,
  googleReviewUrl,
  onFeedback,
}: {
  t: CartaStrings
  title: string
  googleReviewUrl: string | null
  onFeedback: (rating: number, comment: string) => Promise<void>
}) {
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState("")
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle")
  const commentId = useId()

  const send = async () => {
    setState("sending")
    try {
      await onFeedback(rating, comment)
      setState("sent")
    } catch {
      setState("failed")
    }
  }

  return (
    <div className="grid gap-3 rounded-card border border-line bg-surface p-3.5">
      <b>{title}</b>
      <span>{t.howWeDid}</span>
      <div role="group" aria-label={t.rating} className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={k <= rating}
            aria-label={t.stars(k)}
            disabled={state === "sent"}
            onClick={() => setRating(k)}
            className={cn(
              "h-11 w-11 rounded-xl border border-line-strong bg-surface text-[22px] text-muted-fg",
              k <= rating && cn("border-[var(--brand-line)] bg-[var(--brand-tint)]", BRAND_TEXT),
              FOCUS,
            )}
          >
            <span aria-hidden="true">★</span>
          </button>
        ))}
      </div>
      {rating > 0 && (
        <>
          {googleReviewUrl && (
            <a href={googleReviewUrl} target="_blank" rel="noopener noreferrer" className={cn(CTA, BRAND_FILL, "grid place-items-center no-underline", FOCUS)}>
              {t.googleReview}
            </a>
          )}
          {state === "sent" ? (
            <p role="status">{t.feedbackSent}</p>
          ) : (
            <>
              <div className="grid gap-1.5">
                <label htmlFor={commentId} className="text-[13.5px] font-medium">
                  {t.privateComment}
                </label>
                <textarea
                  id={commentId}
                  value={comment}
                  maxLength={500}
                  onChange={(e) => setComment(e.target.value)}
                  className={cn("min-h-[72px] rounded-xl border border-line-strong bg-canvas px-3 py-2.5 text-[15px]", FOCUS)}
                />
              </div>
              {state === "failed" && (
                <p role="alert" className="text-[13.5px] font-medium text-status-danger-fg">
                  {t.feedbackFailed}
                </p>
              )}
              <button type="button" disabled={state === "sending"} onClick={() => void send()} className={cn(GHOST, "text-fg", FOCUS)}>
                {t.sendFeedback}
              </button>
            </>
          )}
        </>
      )}
    </div>
  )
}
