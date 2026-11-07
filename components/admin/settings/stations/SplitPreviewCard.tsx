import { ArrowRight, Split } from "lucide-react"
import type { SplitPreview } from "@/lib/admin/stations"
import { cn } from "@/lib/utils"
import { STATION_STYLE } from "./station-style"

/**
 * "Así se parte una comanda": a sample comanda made of the restaurant's own
 * dishes (one of each, S6: nothing invented) and the ticket each station
 * receives. An exception is highlighted and explained under the tickets.
 */
export function SplitPreviewCard({ preview }: { preview: SplitPreview | null }) {
  return (
    <section aria-labelledby="split-h" className="rounded-card border border-line bg-surface">
      <h2 id="split-h" className="flex items-center gap-2.5 px-4 pb-2 pt-4 font-semibold sm:px-5">
        <Split className="h-[18px] w-[18px]" aria-hidden />
        Así se parte una comanda
      </h2>
      <div className="px-4 pb-4 sm:px-5">
        {!preview ? (
          <p className="text-sm text-muted-fg">Cuando el menú tenga platos activos verás aquí cómo se reparte una comanda.</p>
        ) : (
          <>
            <p className="rounded-xl bg-surface-2 px-3 py-2.5 text-[13px] leading-relaxed">
              <b className="font-semibold">Ejemplo con tus platos</b>
              <br />
              {preview.lines.map((line) => `1× ${line.name}`).join(" · ")}
            </p>
            <p className="mx-0.5 my-2.5 flex items-center gap-2 text-[12.5px] text-muted-fg">
              <ArrowRight className="h-4 w-4" aria-hidden />
              VIPE envía una comanda a cada estación
            </p>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {preview.tickets.map(({ station, lines }) => (
                <div
                  key={station.id}
                  role="group"
                  aria-label={`Comanda de ${station.name}`}
                  className="min-w-0 rounded-xl border border-dashed border-line-strong bg-card px-3 py-2.5 font-mono text-[12.5px] leading-relaxed"
                >
                  <span
                    className={cn(
                      "mb-1.5 inline-flex h-[26px] items-center rounded-full border px-2.5 font-sans text-[12.5px] font-semibold",
                      STATION_STYLE[station.color].chip,
                    )}
                  >
                    {station.name}
                  </span>
                  <hr className="my-1.5 border-dashed border-line-strong" />
                  {lines.map((line) => (
                    <div key={line.name} className={cn("[overflow-wrap:anywhere]", line.exception && "text-brand-strong")}>
                      1× {line.name}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {preview.exception && (
              <p className="mt-2.5 text-[12.5px] text-muted-fg">
                {preview.exception.name} es de {preview.exception.categoryName}, pero se prepara en{" "}
                {preview.tickets.find((ticket) => ticket.station.id === preview.exception!.stationId)?.station.name} (excepción).
              </p>
            )}
          </>
        )}
      </div>
    </section>
  )
}
