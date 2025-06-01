"use client"

import {useCashRegisterStore} from "@/store/use-cash-register-store"
import {formatCurrency} from "@/utils/helpers"
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from "@/components/ui/table"
import {useState} from "react";
import {toast} from "sonner";
import {RefreshCw} from "lucide-react";
import {Button} from "../ui/button";
import {usePagination} from "@/hooks/use-pagination";
import {ItemsPerPage} from "@/components/ui/items-per-page";
import {Pagination} from "@/components/ui/pagination";
import {Skeleton} from "../ui/skeleton";


interface RegisterHistoryTableProps {
    changeRegisterDetails: (registerDate: Date) => void
}

export function RegisterHistoryTable({changeRegisterDetails}: RegisterHistoryTableProps) {
    const {getAllRegisters} = useCashRegisterStore()
    const [isLoading, setIsLoading] = useState(false)
    const registers = getAllRegisters()

    // Ordenar registros por fecha (más reciente primero)
    const sortedRegisters = [...registers].sort(
        (a, b) => new Date(b.openingTimestamp).getTime() - new Date(a.openingTimestamp).getTime(),
    )


    const {currentPage, setCurrentPage, itemsPerPage, setItemsPerPage, totalPages, paginatedData} = usePagination({
        data: sortedRegisters,
        initialItemsPerPage: 5,
    })

    const [refreshing, setRefreshing] = useState(false)

    const handleOpenRegister = async (registerDate: Date) => {
        try {
            setRefreshing(true)
            changeRegisterDetails(registerDate)
            setRefreshing(false)
            window.scrollTo(0, 0)
        } catch (error) {
            toast.error("Error al ver los detalles de la caja")
            setRefreshing(false)
        }
    }

    if (registers.length === 0) {
        return <div className="text-center py-8 text-muted-foreground">No hay registros de caja disponibles</div>
    }

    return (
        <div className="rounded-md border mb-4">

            {/* Paginación */}
            {sortedRegisters.length > 0 && (
                <div className="flex items-center justify-between my-4 px-2">
                    <ItemsPerPage itemsPerPage={itemsPerPage} onChange={setItemsPerPage} options={[10, 25, 50, 100]}/>
                    <div className="text-sm text-muted-foreground">
                        Mostrando {paginatedData.length} de {sortedRegisters.length} órdenes
                    </div>
                    <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage}/>
                </div>
            )}
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Acciones</TableHead>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Apertura</TableHead>
                        <TableHead>Cierre</TableHead>
                        <TableHead>Efectivo Inicial</TableHead>
                        <TableHead>Ventas Totales</TableHead>
                        <TableHead>Estado</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {isLoading ? (
                        // Mostrar skeletons durante la carga
                        Array(5)
                            .fill(0)
                            .map((_, index) => (
                                <TableRow key={`skeleton-${index}`}>
                                    <TableCell>
                                        <Skeleton className="h-5 w-32 mb-2"/>
                                        <Skeleton className="h-4 w-24 mb-1"/>
                                        <Skeleton className="h-3 w-40 mt-1"/>
                                    </TableCell>
                                    <TableCell>
                                        <Skeleton className="h-5 w-24 rounded-full"/>
                                        <Skeleton className="h-5 w-24 rounded-full"/>
                                    </TableCell>
                                    <TableCell>
                                        <Skeleton className="h-4 w-24 rounded-full"/>
                                        <Skeleton className="h-4 w-20"/>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Skeleton className="h-4 w-20 ml-auto"/>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Skeleton className="h-8 w-24 ml-auto"/>
                                    </TableCell>
                                </TableRow>
                            ))
                    ) : sortedRegisters.length === 0 ? (
                        <div className="col-span-full text-center py-10 text-muted-foreground">
                            No hay registros de caja disponibles
                        </div>
                    ) : (
                        paginatedData.map((register) => {
                            // Calcular ventas totales
                            const totalSales = Math.round(register.transactions.reduce((sum, tx) => sum + tx.amount, 0))
                            const totalSalesCash = Math.round(register.cashTransactions.reduce((sum, tx) => sum + tx.amount, 0))

                            const totalSalesValue = totalSales + totalSalesCash

                            return (
                                <TableRow key={register.id}>
                                    <TableCell className="text-center">
                                        <Button variant="outline" size="sm"
                                                onClick={() => handleOpenRegister(register.openingTimestamp)}>
                                            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`}/>
                                            <span>Ver Detalles</span>
                                        </Button>
                                    </TableCell>
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
                        }))
                    }
                </TableBody>
            </Table>

        </div>
    )
}
