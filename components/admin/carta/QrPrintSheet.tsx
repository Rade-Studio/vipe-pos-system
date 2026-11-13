"use client"

import { useEffect } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { qrSvg } from "@/lib/carta/qr"

export type QrPrintTable = { id: string; number: number; zoneName: string | null; url: string }

/**
 * Print-ready tent cards for every table (S18), 6 per A4 page. It overlays the
 * admin on screen and, while printing, hides everything else so the browser
 * prints only the sheet (or saves it as PDF). Printing starts when it opens.
 */
export function QrPrintSheet({
  restaurantName,
  tables,
  onClose,
}: {
  restaurantName?: string
  tables: QrPrintTable[]
  onClose: () => void
}) {
  useEffect(() => {
    const timer = setTimeout(() => window.print(), 0)
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    document.addEventListener("keydown", onKey)
    return () => {
      clearTimeout(timer)
      document.removeEventListener("keydown", onKey)
    }
  }, [onClose])

  return createPortal(
    <section aria-label="QR para imprimir" className="carta-qr-print fixed inset-0 z-50 overflow-auto bg-white text-black">
      <style>{PRINT_CSS}</style>
      <div className="carta-qr-print-bar sticky top-0 flex items-center justify-between gap-2 border-b bg-white p-3">
        <p className="text-sm">Guarda como PDF o imprime: 6 mesas por hoja A4.</p>
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={() => window.print()}>
            Imprimir
          </Button>
          <Button type="button" variant="ghost" size="sm" aria-label="Cerrar" onClick={onClose}>
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="carta-qr-print-grid">
        {tables.map((table) => {
          const label = `Mesa ${table.number}${table.zoneName ? ` · ${table.zoneName}` : ""}`
          return (
            <article key={table.id} className="carta-qr-print-card">
              {restaurantName && <p className="carta-qr-print-name">{restaurantName}</p>}
              <p>Escanea para ver la carta y pedir</p>
              <span
                role="img"
                aria-label={`Código QR de la mesa ${table.number}`}
                className="carta-qr-print-code"
                dangerouslySetInnerHTML={{ __html: qrSvg(table.url) }}
              />
              <p className="carta-qr-print-table">{label}</p>
            </article>
          )
        })}
      </div>
    </section>,
    document.body,
  )
}

const PRINT_CSS = `
.carta-qr-print-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8mm; padding: 10mm; max-width: 210mm; margin: 0 auto; }
.carta-qr-print-card { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2mm; height: 85mm; border: 1px dashed #999; text-align: center; font-size: 11pt; break-inside: avoid; page-break-inside: avoid; }
.carta-qr-print-name { font-size: 14pt; font-weight: 700; }
.carta-qr-print-table { font-size: 13pt; font-weight: 600; }
.carta-qr-print-code, .carta-qr-print-code svg { display: block; width: 50mm; height: 50mm; }
.carta-qr-print-card:nth-child(6n) { break-after: page; page-break-after: always; }
@page { size: A4; margin: 0; }
@media print {
  body > *:not(.carta-qr-print) { display: none !important; }
  .carta-qr-print { position: static !important; overflow: visible !important; }
  .carta-qr-print-bar { display: none !important; }
  .carta-qr-print-grid { padding: 8mm 10mm; gap: 6mm; }
}
`
