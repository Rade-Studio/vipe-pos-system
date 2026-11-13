"use client"

import { useCallback, useState } from "react"
import { Copy, Download, Printer, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { guestUrl, regenerateAllQr, regenerateTableQr, type CartaAdminTable } from "@/lib/api/carta-admin"
import { downloadBlob, fileName, qrPngBlob, qrSvg } from "@/lib/carta/qr"
import { CartaCard, ConfirmDialog } from "./parts"
import { QrPrintSheet } from "./QrPrintSheet"

type Pending = { kind: "all" } | { kind: "table"; table: CartaAdminTable } | null

/** The restaurant slug of a guest path ("/c/<slug>/m/<token>"). */
const slugOf = (guestPath: string) => guestPath.split("/")[2] ?? "carta"

/**
 * QR de las mesas (S17, S18). Each table's code is its full guest URL, shown as
 * a QR image the business downloads as PNG, or prints for all tables at once;
 * regenerating (one or all) asks first because printed codes stop working.
 */
export function QrCard({
  tables,
  origin,
  restaurantName,
  onTables,
}: {
  tables: CartaAdminTable[]
  origin: string
  restaurantName?: string
  onTables: (tables: CartaAdminTable[]) => void
}) {
  const { toast } = useToast()
  const [pending, setPending] = useState<Pending>(null)
  const [open, setOpen] = useState(false)
  const [printing, setPrinting] = useState(false)
  const closePrint = useCallback(() => setPrinting(false), [])

  const zones = new Map<string, CartaAdminTable[]>()
  for (const table of [...tables].sort((a, b) => a.number - b.number)) {
    const zone = table.zoneName ?? "Sin zona"
    zones.set(zone, [...(zones.get(zone) ?? []), table])
  }

  const ask = (next: NonNullable<Pending>) => {
    setPending(next)
    setOpen(true)
  }

  const regenerate = async () => {
    const target = pending
    if (!target) return
    try {
      if (target.kind === "all") {
        onTables(await regenerateAllQr())
      } else {
        const fresh = await regenerateTableQr(target.table.id)
        onTables(tables.map((table) => (table.id === fresh.id ? fresh : table)))
      }
      toast({ title: "Códigos regenerados", description: "Imprime los nuevos QR." })
    } catch {
      toast({ title: "No se pudieron regenerar los códigos", description: "Intenta de nuevo.", variant: "destructive" })
    }
  }

  const copy = (url: string) => {
    void navigator.clipboard?.writeText(url).catch(() => {})
    toast({ title: "Enlace copiado" })
  }

  const download = async (table: CartaAdminTable, url: string) => {
    try {
      downloadBlob(await qrPngBlob(url, 1024), fileName(slugOf(table.guestPath), table.number))
    } catch {
      toast({ title: "No se pudo descargar el QR", description: "Intenta de nuevo.", variant: "destructive" })
    }
  }

  return (
    <CartaCard
      id="carta-qr"
      number={8}
      title="QR de las mesas"
      description="Cada mesa tiene su código: el pedido llega a la mesa correcta."
      actions={
        tables.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setPrinting(true)}>
              <Printer className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Descargar todas
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => ask({ kind: "all" })}>
              <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Regenerar todos
            </Button>
          </div>
        )
      }
    >
      {tables.length === 0 && <p className="text-sm text-muted-foreground">Crea mesas en Mesas para tener sus códigos.</p>}
      <p className="text-sm text-muted-foreground">Descarga el QR de cada mesa o imprímelos todos en hojas A4.</p>
      {[...zones].map(([zone, list]) => (
        <section key={zone} aria-label={zone} className="space-y-2">
          <h3 className="text-sm font-semibold">{zone}</h3>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((table) => {
              const url = guestUrl(origin, table.guestPath)
              return (
                <li key={table.id} className="min-w-0 space-y-2 rounded-md border p-3">
                  <p className="text-sm font-semibold">Mesa {table.number}</p>
                  <span
                    role="img"
                    aria-label={`Código QR de la mesa ${table.number}`}
                    className="mx-auto block h-40 w-40 [&>svg]:h-full [&>svg]:w-full"
                    dangerouslySetInnerHTML={{ __html: qrSvg(url) }}
                  />
                  <p className="text-center text-sm">
                    Mesa {table.number} · {zone}
                  </p>
                  <p className="break-all font-mono text-xs text-muted-foreground">{url}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" aria-label={`Descargar PNG de la mesa ${table.number}`} onClick={() => void download(table, url)}>
                      <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
                      Descargar PNG
                    </Button>
                    <Button type="button" variant="outline" size="sm" aria-label={`Copiar enlace de la mesa ${table.number}`} onClick={() => copy(url)}>
                      <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />
                      Copiar enlace
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Regenerar QR de la mesa ${table.number}`}
                      onClick={() => ask({ kind: "table", table })}
                    >
                      Regenerar
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {printing && (
        <QrPrintSheet
          restaurantName={restaurantName}
          tables={tables
            .slice()
            .sort((a, b) => a.number - b.number)
            .map((table) => ({ id: table.id, number: table.number, zoneName: table.zoneName, url: guestUrl(origin, table.guestPath) }))}
          onClose={closePrint}
        />
      )}

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={pending?.kind === "table" ? `¿Regenerar el código de la mesa ${pending.table.number}?` : "¿Regenerar todos los códigos?"}
        description={
          pending?.kind === "table"
            ? `Los QR impresos dejarán de funcionar. Tendrás que imprimir y pegar el nuevo en la mesa ${pending.table.number}.`
            : `Los QR impresos dejarán de funcionar. Tendrás que imprimir y pegar los nuevos en las ${tables.length} mesas.`
        }
        confirmLabel="Sí, regenerar"
        onConfirm={() => void regenerate()}
      />
    </CartaCard>
  )
}
