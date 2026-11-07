"use client"

import { cn } from "@/lib/utils"

export type UpdateChannelValue = "stable" | "pilot"

const CHANNELS: { value: UpdateChannelValue; label: string; text: string; recommended?: boolean }[] = [
  { value: "stable", label: "Estable", text: "Versiones ya probadas en otros restaurantes.", recommended: true },
  { value: "pilot", label: "Piloto", text: "Recibe cada versión una semana antes. Útil si quieres probar novedades primero." },
]

interface UpdateChannelProps {
  businessName: string
  value: UpdateChannelValue | undefined
  disabled: boolean
  onChange: (value: UpdateChannelValue) => void
}

/** "Actualizaciones": business_config desktopUpdateChannel (L34). */
export function UpdateChannel({ businessName, value, disabled, onChange }: UpdateChannelProps) {
  return (
    <section aria-labelledby="upd-h" className="rounded-card border border-line bg-surface">
      <div className="px-[18px] pb-1 pt-4">
        <h2 id="upd-h" className="text-[15px] font-semibold">Actualizaciones</h2>
        <p className="mt-1 text-[13px] text-muted-fg">
          Los computadores{businessName ? ` de ${businessName}` : ""} se actualizan solos, de noche y nunca mientras imprimen.
        </p>
      </div>
      <div role="radiogroup" aria-labelledby="upd-h" className="grid gap-3 px-[18px] pb-[18px] pt-3 md:grid-cols-2">
        {CHANNELS.map((channel) => {
          const checked = value === channel.value
          return (
            <button
              key={channel.value}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={disabled}
              onClick={() => !checked && onChange(channel.value)}
              className={cn(
                "flex min-h-11 flex-col gap-2.5 rounded-card border border-line-strong bg-card p-4 text-left disabled:cursor-not-allowed disabled:opacity-70",
                "focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                checked && "border-brand bg-brand-tint ring-2 ring-brand-line",
              )}
            >
              <span className="flex w-full items-center gap-2.5">
                <span
                  aria-hidden
                  className={cn("grid h-[22px] w-[22px] flex-none place-items-center rounded-full border-2 border-line-strong", checked && "border-brand")}
                >
                  {checked && <span className="h-2.5 w-2.5 rounded-full bg-brand" />}
                </span>
                <b className="min-w-0 flex-1 text-[15px]">{channel.label}</b>
                {channel.recommended && (
                  <span className="rounded-full border border-status-ok-line bg-status-ok-bg px-2 py-0.5 text-xs font-semibold text-status-ok-fg">Recomendado</span>
                )}
              </span>
              <span className="text-[13px] text-fg/80">{channel.text}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
