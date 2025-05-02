"use client"

import { useRef } from "react"
import { Button } from "@/components/ui/button"
import { Printer } from "lucide-react"
import { formatDate } from "@/utils/helpers"
import type { PrintableKitchenOrder } from "@/types"

interface KitchenOrderPrintViewProps {
  order: PrintableKitchenOrder
  onClose: () => void
}

export function KitchenOrderPrintView({ order, onClose }: KitchenOrderPrintViewProps) {
  const printRef = useRef<HTMLDivElement>(null)

  const handlePrint = () => {
    const content = printRef.current
    if (!content) return

    const printWindow = window.open("", "_blank")
    if (!printWindow) return

    // Crear el contenido HTML para imprimir
    const html = `
      <html>
        <head>
          <title>Comanda ${order.orderNumber}</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              margin: 0;
              padding: 20px;
              font-size: 14px;
            }
            .order-container {
              max-width: 80mm;
              margin: 0 auto;
            }
            .header {
              text-align: center;
              margin-bottom: 20px;
            }
            .order-title {
              font-size: 16px;
              font-weight: bold;
              margin: 15px 0;
              text-align: center;
            }
            .info-row {
              display: flex;
              justify-content: space-between;
              margin-bottom: 5px;
            }
            .divider {
              border-top: 1px dashed #000;
              margin: 10px 0;
            }
            .item-row {
              margin-bottom: 10px;
            }
            .item-name {
              font-weight: bold;
              font-size: 16px;
            }
            .item-quantity {
              font-size: 18px;
              font-weight: bold;
            }
            .comments {
              font-style: italic;
              margin-top: 5px;
            }
            @media print {
              body {
                width: 80mm;
                margin: 0;
                padding: 0;
              }
            }
          </style>
        </head>
        <body>
          <div class="order-container">
            <div class="order-title">COMANDA ${order.orderNumber}</div>
            
            <div class="info-row">
              <div>Fecha:</div>
              <div>${formatDate(order.date)}</div>
            </div>
            <div class="info-row">
              <div>Mesa:</div>
              <div>${order.table}</div>
            </div>
            <div class="info-row">
              <div>Mesero:</div>
              <div>${order.waiter}</div>
            </div>
            
            <div class="divider"></div>
            
            ${order.items
              .map(
                (item) => `
              <div class="item-row">
                <div class="info-row">
                  <div class="item-name">${item.name}</div>
                  <div class="item-quantity">x${item.quantity}</div>
                </div>
                ${item.comments ? `<div class="comments">${item.comments}</div>` : ""}
              </div>
            `,
              )
              .join("")}
          </div>
          <script>
            window.onload = function() {
              window.print();
              window.onafterprint = function() {
                window.close();
              }
            }
          </script>
        </body>
      </html>
    `

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
