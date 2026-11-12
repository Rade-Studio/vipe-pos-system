import type { ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

/** Header data shared by the count sheet and the adjustment record. */
export interface CountPrintHeader {
  number: number
  locationName: string
  counterName: string | null
  approverName: string | null
  date: Date
  businessName?: string
}

export interface CountSheetPrintLine {
  name: string
  sku: string
  unit: string
  /** Category (or other group) printed as a section heading. */
  group: string
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string)

export const printDate = (date: Date) =>
  date.toLocaleString("es-CO", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })

/** Opens a US Letter print window for a document, like `printSlip` does for the 80 mm slips. */
export function printLetter(doc: ReactElement, title: string): boolean {
  const printWindow = window.open("", "_blank")
  if (!printWindow) return false
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
@page{size:letter portrait;margin:15mm}
body{margin:0;font-family:system-ui,sans-serif;font-size:11pt;color:#000}
h1{font-size:15pt;margin:0 0 6pt}
dl{display:grid;grid-template-columns:repeat(2,auto);gap:2pt 16pt;margin:0 0 8pt}
dt{font-weight:600}dd{margin:0}
table{width:100%;border-collapse:collapse;margin:8pt 0}
th,td{border:1px solid #999;padding:4pt 6pt;text-align:left;vertical-align:top}
td[data-num],th[data-num]{text-align:right;font-variant-numeric:tabular-nums}
tr[data-group] td{background:#eee;font-weight:600}
td[data-blank]{height:16pt}
[data-signatures]{display:flex;gap:32pt;margin-top:32pt}
[data-signatures] div{flex:1;border-top:1px solid #000;padding-top:4pt}
</style></head>
<body>${renderToStaticMarkup(doc)}
<script>window.onload=function(){window.print();window.onafterprint=function(){window.close()}}</script>
</body></html>`
  printWindow.document.open()
  printWindow.document.write(html)
  printWindow.document.close()
  return true
}

export function CountPrintMeta({ header, approverLabel }: { header: CountPrintHeader; approverLabel: string }) {
  return (
    <dl>
      <dt>Bodega</dt>
      <dd>{header.locationName}</dd>
      <dt>Fecha</dt>
      <dd>{printDate(header.date)}</dd>
      <dt>Contó</dt>
      <dd>{header.counterName ?? "—"}</dd>
      <dt>{approverLabel}</dt>
      <dd>{header.approverName ?? "—"}</dd>
    </dl>
  )
}

export function Signatures({ counterName, approverName, approverLabel }: { counterName: string | null; approverName: string | null; approverLabel: string }) {
  return (
    <div data-signatures="">
      <div>Contó: {counterName ?? ""} · firma</div>
      <div>
        {approverLabel}: {approverName ?? ""} · firma
      </div>
    </div>
  )
}

/**
 * "Hoja de conteo" (S5): blind, grouped, with an empty quantity column to
 * write by hand. It never carries the expected stock.
 */
export function CountSheetPrint({ header, lines }: { header: CountPrintHeader; lines: CountSheetPrintLine[] }) {
  const groups = new Map<string, CountSheetPrintLine[]>()
  for (const line of [...lines].sort((a, b) => a.group.localeCompare(b.group, "es") || a.name.localeCompare(b.name, "es"))) {
    groups.set(line.group, [...(groups.get(line.group) ?? []), line])
  }
  return (
    <article role="document" aria-label="Hoja de conteo">
      <h1>Hoja de conteo · Conteo #{header.number}</h1>
      <CountPrintMeta header={header} approverLabel="Revisa" />
      <p>Conteo a ciegas: escribe lo que hay. Pesa lo abierto. Si no hay, escribe 0. No cuentes lo que está en tránsito sin recibir.</p>
      <table>
        <thead>
          <tr>
            <th style={{ width: "50%" }}>Artículo</th>
            <th>Unidad</th>
            <th style={{ width: "18%" }}>Cantidad</th>
            <th>Observación</th>
          </tr>
        </thead>
        <tbody>
          {[...groups].flatMap(([group, rows]) => [
            <tr key={`g-${group}`} data-group="">
              <td colSpan={4}>{group}</td>
            </tr>,
            ...rows.map((line) => (
              <tr key={`${group}-${line.sku}-${line.name}`}>
                <td>
                  {line.name} <small>{line.sku}</small>
                </td>
                <td>{line.unit}</td>
                <td data-blank="" />
                <td />
              </tr>
            )),
          ])}
        </tbody>
      </table>
      <p>{lines.length} artículos</p>
      <Signatures counterName={header.counterName} approverName={header.approverName} approverLabel="Revisó" />
      {header.businessName && <p>VipePOS · {header.businessName}</p>}
    </article>
  )
}
