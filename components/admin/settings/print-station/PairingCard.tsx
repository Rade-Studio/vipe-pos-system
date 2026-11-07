"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, Clock, Copy, KeyRound, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { codeGroups, countdown } from "@/lib/admin/print-station"
import type { DesktopDeviceDto, DesktopPairingCodeDto } from "@/lib/api/desktop"
import { cn } from "@/lib/utils"

export type PairingState =
  | { kind: "idle" }
  | { kind: "showing"; code: DesktopPairingCodeDto }
  | { kind: "expired"; code: DesktopPairingCodeDto }
  | { kind: "connected"; device: DesktopDeviceDto }

interface PairingCardProps {
  state: PairingState
  busy: boolean
  onGenerate: () => void
  onCopy: (code: string) => void
  onExpire: () => void
  onClose: () => void
}

const BTN = "min-h-11 rounded-full"
const NOTE = "flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[13.5px]"

function Code({ code, dead }: { code: string; dead?: boolean }) {
  const digits = code.split("").join(" ")
  return (
    <div
      aria-label={dead ? `Código vencido ${digits}` : `Código ${digits}`}
      className={cn(
        "flex gap-[0.4em] font-mono text-[44px] font-bold leading-none tracking-[.06em] tabular-nums md:text-[56px]",
        dead && "text-muted-fg line-through decoration-[3px]",
      )}
    >
      {codeGroups(code).map((group, i) => (
        <span key={i}>{group}</span>
      ))}
    </div>
  )
}

/** Live `m:ss` until `expiresAt`; calls `onExpire` once at zero. */
function Timer({ expiresAt, onExpire }: { expiresAt: string; onExpire: () => void }) {
  const [now, setNow] = useState(() => Date.now())
  const left = Date.parse(expiresAt) - now
  const expired = left <= 0
  useEffect(() => {
    if (expired) {
      onExpire()
      return
    }
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [expired, onExpire])
  return (
    <span
      role="timer"
      aria-label="Tiempo restante"
      className="inline-flex h-[26px] items-center gap-2 rounded-full border border-status-served-line bg-status-served-bg px-2.5 text-[15px] font-semibold tabular-nums text-status-served-fg"
    >
      <Clock className="h-3.5 w-3.5" aria-hidden />
      Vence en&nbsp;{countdown(left)}
    </span>
  )
}

/** "Conectar un computador": generate, show with countdown, expiry and the new computer. */
export function PairingCard({ state, busy, onGenerate, onCopy, onExpire, onClose }: PairingCardProps) {
  return (
    <section aria-labelledby="pair-h" className="rounded-card border border-line bg-surface">
      <div className="px-[18px] pb-1 pt-4">
        <h2 id="pair-h" className="text-[15px] font-semibold">Conectar un computador</h2>
        <p className="mt-1 text-[13px] text-muted-fg">
          El computador con impresoras debe tener instalada la app VIPE. Genera un código y escríbelo en ese equipo.
        </p>
      </div>
      {state.kind === "idle" && (
        <div className="p-[18px]">
          <Button className={BTN} disabled={busy} onClick={onGenerate}>
            <KeyRound className="mr-2 h-4 w-4" aria-hidden />
            Generar código
          </Button>
          <p className="mt-1.5 text-[12.5px] text-muted-fg">El código dura 10 minutos y sirve para un solo computador.</p>
        </div>
      )}
      {(state.kind === "showing" || state.kind === "expired") && (
        <div className="grid gap-4 p-[18px]">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <Code code={state.code.code} dead={state.kind === "expired"} />
            {state.kind === "showing" && (
              <Button variant="outline" className={BTN} onClick={() => onCopy(state.code.code)}>
                <Copy className="mr-2 h-4 w-4" aria-hidden />
                Copiar
              </Button>
            )}
          </div>
          {state.kind === "showing" ? (
            <>
              <div className="flex flex-wrap items-center gap-2.5">
                <Timer expiresAt={state.code.expiresAt} onExpire={onExpire} />
                <span role="status" className="text-[12.5px] text-muted-fg">Esperando que el otro computador escriba el código…</span>
              </div>
              <ol className="grid gap-2.5 text-[13.5px] text-fg/80">
                {[
                  <>En el computador de las impresoras abre la app VIPE y elige <b>Conectar con código</b>.</>,
                  "Escribe los 6 dígitos de este código.",
                  "Espera aquí: el computador aparecerá en la lista en unos segundos.",
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-brand-tint text-[12.5px] font-bold text-brand-strong">{i + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              <div><Button variant="outline" className={BTN} onClick={onClose}>Cancelar código</Button></div>
            </>
          ) : (
            <>
              <div role="status" className={cn(NOTE, "border-status-warning-line bg-status-warning-bg text-status-warning-fg")}>
                <AlertTriangle className="mt-px h-[18px] w-[18px] flex-none" aria-hidden />
                <span className="min-w-0 flex-1"><b>El código venció.</b> Pasaron 10 minutos sin que ningún computador lo usara.</span>
              </div>
              <div className="flex flex-wrap gap-2.5">
                <Button className={BTN} disabled={busy} onClick={onGenerate}>
                  <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
                  Generar otro
                </Button>
                <Button variant="ghost" className={BTN} onClick={onClose}>Cerrar</Button>
              </div>
            </>
          )}
        </div>
      )}
      {state.kind === "connected" && (
        <div className="grid gap-3 p-[18px]">
          <div role="status" className={cn(NOTE, "border-status-ok-line bg-status-ok-bg text-status-ok-fg")}>
            <CheckCircle2 className="mt-px h-[18px] w-[18px] flex-none" aria-hidden />
            <span className="min-w-0 flex-1">
              <b>{state.device.name} se conectó.</b> Windows · VIPE {state.device.appVersion}
              {state.device.printers.length > 0 &&
                ` · ${state.device.printers.length} ${state.device.printers.length === 1 ? "impresora encontrada" : "impresoras encontradas"}`}
              . Ya puede imprimir.
            </span>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <Button variant="outline" className={BTN} onClick={onClose}>Listo</Button>
            <Button variant="ghost" className={BTN} disabled={busy} onClick={onGenerate}>Conectar otro</Button>
          </div>
        </div>
      )}
    </section>
  )
}
