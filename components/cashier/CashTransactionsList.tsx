"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { formatCurrency, formatDateTime } from "@/utils/helpers"
import type { CashTransaction } from "@/types/cash-register"

interface CashTransactionsListProps {
  transactions: CashTransaction[]
  showTitle?: boolean
}

export function CashTransactionsList({ transactions, showTitle = true }: CashTransactionsListProps) {
  if (transactions.length === 0) {
    return (
      <Card>
        {showTitle && (
          <CardHeader>
            <CardTitle>Movimientos de Efectivo</CardTitle>
          </CardHeader>
        )}
        <CardContent>
          <div className="text-center py-4 text-muted-foreground">No hay movimientos de efectivo registrados</div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      {showTitle && (
        <CardHeader>
          <CardTitle>Movimientos de Efectivo</CardTitle>
        </CardHeader>
      )}
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead className="text-right">Monto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((transaction) => (
                <TableRow key={transaction.id}>
                  <TableCell className="font-medium">{formatDateTime(transaction.timestamp)}</TableCell>
                  <TableCell>
                    <Badge variant={transaction.type === "deposit" ? "default" : "destructive"}>
                      {transaction.type === "deposit" ? "Ingreso" : "Retiro"}
                    </Badge>
                  </TableCell>
                  <TableCell>{transaction.description}</TableCell>
                  <TableCell className="text-right">{formatCurrency(transaction.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
