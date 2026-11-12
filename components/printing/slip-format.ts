import { createElement, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { differenceStatus } from "@/lib/payments/denominations"

/**
 * Shared formatting of the thermal slips (caja-cierres S4): pesos `$ 1.234.567`,
 * es-CO dates, fixed-width lines, and the browser print window (same
 * mechanism as KitchenOrderPrintView: a new window that prints itself).
 */

export type PaperMm = 58 | 80

/** Characters per line: ~42 on 80 mm paper, ~32 on 58 mm. */
export function slipChars(paperMm: PaperMm = 80): number {
  return paperMm === 58 ? 32 : 42
}

const thousands = (amount: number) => Math.abs(Math.round(amount)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")

/** `$ 1.234.567`; a negative amount reads `−$ 3.500`. */
export function pesos(amount: number): string {
  return `${amount < 0 ? "−" : ""}$ ${thousands(amount)}`
}

/** `+$ 2.000`, `−$ 3.500`, `$ 0`. */
export function signedPesos(amount: number): string {
  return amount > 0 ? `+${pesos(amount)}` : pesos(amount)
}

/** `Cuadra`, `Sobrante +$ 2.000`, `Faltante −$ 3.500`. */
export function differenceText(difference: number): string {
  const status = differenceStatus(difference)
  return status.kind === "even" ? status.label : `${status.label} ${signedPesos(difference)}`
}

const two = (n: number) => n.toString().padStart(2, "0")

/** `10/11/2026`. */
export function slipDate(date: Date): string {
  return `${two(date.getDate())}/${two(date.getMonth() + 1)}/${date.getFullYear()}`
}

/** `7:58 a.m.`, `3:02 p.m.`. */
export function slipTime(date: Date): string {
  const hours = date.getHours()
  return `${hours % 12 === 0 ? 12 : hours % 12}:${two(date.getMinutes())} ${hours < 12 ? "a.m." : "p.m."}`
}

/** `10/11/2026 7:58 a.m.`. */
export function slipDateTime(date: Date): string {
  return `${slipDate(date)} ${slipTime(date)}`
}

/** `left` and `right` on one line of `width` characters; a long left side is cut with `…`. */
export function padLine(left: string, right: string, width: number): string {
  if (!right) return left.length > width ? `${left.slice(0, width - 1)}…` : left
  const room = width - right.length - 1
  const label = left.length > room ? `${left.slice(0, Math.max(0, room - 1))}…` : left
  return `${label}${" ".repeat(Math.max(1, width - label.length - right.length))}${right}`
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c)

/**
 * Prints a slip from the browser: a new window with the slip's markup at the
 * paper width that prints itself and closes. False when the browser blocked it.
 */
export function printSlip(slip: ReactElement, { title, paperMm = 80 }: { title: string; paperMm?: PaperMm }): boolean {
  const printWindow = window.open("", "_blank")
  if (!printWindow) return false
  const width = `${paperMm}mm`
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
@page{size:${width} auto;margin:0}
body{margin:0;padding:4mm 0;font-family:ui-monospace,"Courier New",monospace;font-size:${paperMm === 58 ? 11 : 12}px;color:#000}
.slip{width:${width};margin:0 auto}
[data-line]{white-space:pre;line-height:1.35}
[data-bold]{font-weight:700}
</style></head>
<body>${renderToStaticMarkup(slip)}
<script>window.onload=function(){window.print();window.onafterprint=function(){window.close()}}</script>
</body></html>`
  printWindow.document.open()
  printWindow.document.write(html)
  printWindow.document.close()
  return true
}

// ---- Lines --------------------------------------------------------------------------

/** One printed line; `bold` for headings and totals. */
export type SlipLine = { text: string; bold?: boolean }

/** Business data printed on every slip (settings: name, NIT, address). */
export type SlipBusiness = { name: string; nit: string; address: string }

export function centerLine(text: string, width: number): string {
  const cut = text.length > width ? text.slice(0, width) : text
  return `${" ".repeat(Math.floor((width - cut.length) / 2))}${cut}`
}

/** Word-wraps free text (the close note) to the paper width. */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = []
  let current = ""
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (current && current.length + 1 + word.length > width) {
      lines.push(current)
      current = ""
    }
    current = current ? `${current} ${word}` : word
    while (current.length > width) {
      lines.push(current.slice(0, width))
      current = current.slice(width)
    }
  }
  if (current) lines.push(current)
  return lines
}

export const ruleLine = (width: number): SlipLine => ({ text: "-".repeat(width) })

/** Business name, NIT and address, centered. */
export function businessLines(business: SlipBusiness, width: number): SlipLine[] {
  return [
    { text: centerLine(business.name.toUpperCase(), width), bold: true },
    ...(business.nit ? [{ text: centerLine(`NIT ${business.nit}`, width) }] : []),
    ...(business.address ? [{ text: centerLine(business.address, width) }] : []),
  ]
}

/** The slip as monospace lines; `label` names it for screen readers and tests. */
export function SlipDocument({ label, lines, paperMm = 80 }: { label: string; lines: SlipLine[]; paperMm?: PaperMm }) {
  return createElement(
    "div",
    { role: "document", "aria-label": label, className: "slip font-mono text-xs", "data-paper": paperMm },
    lines.map((line, index) =>
      createElement(
        "div",
        { key: index, "data-line": "", ...(line.bold ? { "data-bold": "" } : {}), style: { whiteSpace: "pre", fontWeight: line.bold ? 700 : 400 } },
        line.text || " ",
      ),
    ),
  )
}
