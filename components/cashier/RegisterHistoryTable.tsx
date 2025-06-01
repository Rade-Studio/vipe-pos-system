"use client"

import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { formatCurrency } from "@/utils/helpers"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {useEffect} from "react";

export function RegisterHistoryTable() {
  const { getAllRegisters} = useCashRegisterStore()
  const registers = getAllRegisters()

  console.log("------------------- registers -------------------", registers)

  // Ordenar registros por fecha (más reciente primero)
  const sortedRegisters = [...registers].sort(
    (a, b) => new Date(b.openingTimestamp).getTime() - new Date(a.openingTimestamp).getTime(),
  )

  if (registers.length === 0) {
    return <div className="text-center py-8 text-muted-foreground">No hay registros de caja disponibles</div>
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Apertura</TableHead>
            <TableHead>Cierre</TableHead>
            <TableHead>Efectivo Inicial</TableHead>
            <TableHead>Ventas Totales</TableHead>
            <TableHead>Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedRegisters.map((register) => {
            // Calcular ventas totales
            const totalSales = Math.round(register.transactions.reduce((sum, tx) => sum + tx.amount, 0))
            const totalSalesCash = Math.round(register.cashTransactions.reduce((sum, tx) => sum + tx.amount, 0))

            const totalSalesValue = totalSales + totalSalesCash


            return (
              <TableRow key={register.id}>
                <TableCell>{new Date(register.openingTimestamp).toLocaleDateString()}</TableCell>
                <TableCell>{new Date(register.openingTimestamp).toLocaleTimeString()}</TableCell>
                <TableCell>
                  {register.closingTimestamp ? new Date(register.closingTimestamp).toLocaleTimeString() : "-"}
                </TableCell>
                <TableCell>{formatCurrency(register.initialCash)}</TableCell>
                <TableCell>{formatCurrency(totalSalesValue)}</TableCell>
                <TableCell>
                  <span
                    className={`px-2 py-1 rounded-full text-xs ${
                      register.status === "open" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {register.status === "open" ? "Abierta" : "Cerrada"}
                  </span>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
