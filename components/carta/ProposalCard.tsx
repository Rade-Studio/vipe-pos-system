"use client"

import { formatTime } from "@/lib/carta/format"
import type { CartaStrings } from "@/lib/carta/i18n"
import { STAGE_STEP, type GuestProposal } from "@/lib/carta/table"
import { cn } from "@/lib/utils"
import { CHIP, TONES } from "./styles"

/** Local "HH:MM" of an API instant, as the carta prints times ("12:41 pm"). */
export function clock(iso: string | null): string {
  if (!iso) return ""
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return formatTime(`${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`)
}

/**
 * One sent proposal (S12, artboard `proposalHtml`): Enviado → Confirmado →
 * En la cocina → Servido; a rejected one shows the waiter's reason and a
 * cancelled one (every linked item voided) reads "Anulado".
 */
export function ProposalCard({ proposal, waiter, t }: { proposal: GuestProposal; waiter: string; t: CartaStrings }) {
  const lines = <div className="text-[13px] text-muted-fg">{proposal.lines.map((l) => `${l.quantity} × ${l.name ?? ""}`).join(" · ")}</div>

  if (proposal.stage === "rejected" || proposal.stage === "cancelled") {
    const rejected = proposal.stage === "rejected"
    return (
      <div className="grid gap-2 rounded-card border border-line bg-surface p-3.5">
        <div className="flex items-center justify-between gap-2.5">
          <b>{rejected ? t.rejected : t.cancelled}</b>
          <span className={cn(CHIP, rejected ? TONES.danger : TONES.reserved)}>{clock(proposal.decidedAt ?? proposal.createdAt)}</span>
        </div>
        {rejected && <p className="text-[13.5px]">{proposal.rejectReason ? t.rejectedReason(proposal.rejectReason) : t.rejectedHint}</p>}
        {lines}
      </div>
    )
  }

  const step = STAGE_STEP[proposal.stage]
  const rows = [
    { label: t.stageSent(waiter), time: clock(proposal.createdAt), hint: null },
    { label: t.stageConfirmed(waiter), time: step >= 1 ? clock(proposal.decidedAt) : "", hint: t.stageConfirmedHint },
    { label: t.stageKitchen, time: step >= 2 ? clock(proposal.decidedAt) : "", hint: null },
    { label: t.stageServed, time: "", hint: null },
  ]
  return (
    <div className="grid gap-3 rounded-card border border-line bg-surface p-3.5">
      <div className="flex items-center justify-between gap-2.5">
        <b>{step === 0 ? t.waitingFor(waiter) : t.onItsWay}</b>
        <span className={cn(CHIP, step === 0 ? TONES.warning : TONES.kitchen)}>{step === 0 ? t.chipProposal : t.chipConfirmed}</span>
      </div>
      <ol aria-label={t.stageSteps} className="grid">
        {rows.map((row, i) => {
          const state = i <= step ? "done" : i === step + 1 ? "now" : "todo"
          return (
            <li
              key={row.label}
              data-state={state}
              className="relative grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-2.5 pb-3.5 text-sm last:pb-0"
            >
              {i < rows.length - 1 && (
                <span
                  aria-hidden="true"
                  className={cn("absolute bottom-0.5 left-[13px] top-[26px] w-0.5", state === "done" ? "bg-[var(--brand)]" : "bg-line-strong")}
                />
              )}
              <span
                aria-hidden="true"
                className={cn(
                  "relative z-[1] grid h-7 w-7 place-items-center rounded-full border-2 text-[13px] font-bold",
                  state === "done"
                    ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--brand-contrast)]"
                    : state === "now"
                      ? "border-[var(--brand)] bg-canvas text-[var(--brand-text)]"
                      : "border-line-strong bg-canvas text-muted-fg",
                )}
              >
                {state === "done" ? "✓" : i + 1}
              </span>
              <span>
                {row.label}
                {row.hint && i === 1 && <small className="block text-[12.5px] text-muted-fg">{row.hint}</small>}
              </span>
              <time className="text-[12.5px] text-muted-fg">{row.time}</time>
            </li>
          )
        })}
      </ol>
      {lines}
    </div>
  )
}
