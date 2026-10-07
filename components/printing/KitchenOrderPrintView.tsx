"use client"

import { useRef } from "react"
import { Button } from "@/components/ui/button"
import { Printer } from "lucide-react"
import { formatDate } from "@/utils/helpers"
import { renderKitchenOrder } from "@/lib/print/renderKitchenOrder"
import type { PrintableKitchenOrder } from "@/types"

interface KitchenOrderPrintViewProps {
  order: PrintableKitchenOrder
  onClose: () => void
}

/**
 * Render a PrintLine[] into a minimal HTML string for the browser print window.
 * This is the web-side consumer of the shared PrintLine[] data structure.
 */
function renderLinesToHtml(
  orderNumber: string,
  lines: Array<{ text: string; bold?: boolean; align?: string }>,
): string {
  const alignClass = (align?: string) => {
    if (align === "center") return 'style="text-align:center"'
    if (align === "right") return 'style="text-align:right"'
    return 'style="text-align:left"'
  }

  const body = lines
    .map((line) => {
      const bold = line.bold ? "<strong>" : ""
      const boldClose = line.bold ? "</strong>" : ""
      return `<div ${alignClass(line.align)}>${bold}${line.text}${boldClose}</div>`
    })
    .join("\n")

  return `<html>
<head><title>Comanda ${orderNumber}</title>
<style>
body{font-family:Arial,sans-serif;margin:0;padding:20px;font-size:14px}
.order-container{max-width:80mm;margin:0 auto}
@media print{body{width:80mm;margin:0;padding:0}}
</style>
</head>
<body><div class="order-container">${body}</div>
<script>window.onload=function(){window.print();window.onafterprint=function(){window.close()}}</script>
</body></html>`
}

export function KitchenOrderPrintView({ order, onClose }: KitchenOrderPrintViewProps) {
  const printRef = useRef<HTMLDivElement>(null)

  // Use the shared renderer to produce the data structure.
  const rendered = renderKitchenOrder({
    orderNumber: order.orderNumber,
    table: order.table,
    waiter: order.waiter,
    items: order.items,
  })

  const handlePrint = () => {
    const content = printRef.current
    if (!content) return

    const printWindow = window.open("", "_blank")
    if (!printWindow) return

    const html = renderLinesToHtml(order.orderNumber, rendered.lines)
    printWindow.document.open()
    printWindow.document.write(html)
    printWindow.document.close()
  }

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">Vista previa de comanda</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
          <Button onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" />
            Imprimir
          </Button>
        </div>
      </div>

      <div className="border rounded-lg p-6 bg-white dark:bg-gray-800 dark:text-white max-w-md mx-auto" ref={printRef}>
        <h4 className="text-center font-bold text-xl mb-4">COMANDA {order.orderNumber}</h4>

        <div className="flex justify-between mb-1">
          <span>Fecha:</span>
          <span>{formatDate(order.date)}</span>
        </div>
        <div className="flex justify-between mb-1">
          <span>Mesa:</span>
          <span>{order.table}</span>
        </div>
        <div className="flex justify-between mb-4">
          <span>Mesero:</span>
          <span>{order.waiter}</span>
        </div>

        <div className="border-t border-dashed my-4 dark:border-gray-600"></div>

        <div className="space-y-4">
          {order.items.map((item) => (
            <div key={item.id} className="text-lg">
              <div className="flex justify-between">
                <span className="font-bold">{item.name}</span>
                <span className="font-bold text-xl">x{item.quantity}</span>
              </div>
              {item.comments && <div className="italic mt-1 dark:text-gray-300">{item.comments}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
