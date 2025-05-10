"use client"

import { useState, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DatePicker } from "@/components/ui/date-picker"
import { StockTransactionForm } from "./StockTransactionForm"
import { useToast } from "@/hooks/use-toast"
import { supabase } from "@/lib/supabase"
import { Search, Plus, FileDown, FileText, RefreshCw, Filter, X, Calendar, CheckCircle, Clock } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/utils/helpers"
import { Pagination } from "@/components/ui/pagination"
import { ItemsPerPage } from "@/components/ui/items-per-page"
import { usePagination } from "@/hooks/use-pagination"

export function StockTransactionsList() {
  const { toast } = useToast()
  const [transactions, setTransactions] = useState<any[]>([])
  const [ingredients, setIngredients] = useState<any[]>([])
  const [categories, setCategories] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [openDialog, setOpenDialog] = useState(false)
  const [selectedIngredient, setSelectedIngredient] = useState<string | null>(null)
  const [selectedNotes, setSelectedNotes] = useState<string | null>(null)
  const [notesDialogOpen, setNotesDialogOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)

  // Filtros
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined)
  const [useDefaultDateRange, setUseDefaultDateRange] = useState(true)
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [minAmount, setMinAmount] = useState<string>("")
  const [maxAmount, setMaxAmount] = useState<string>("")
  const [sortBy, setSortBy] = useState<string>("date-desc")

  const fetchTransactions = async () => {
    setLoading(true)
    try {
      let query = supabase.from("ingredient_transactions").select(`
          *,
          ingredients:ingredient_id (
            id,
            name,
            unit,
            category_id,
            ingredient_categories:category_id (
              id,
              name
            )
          )
        `)

      // Aplicar filtro de fecha
      if (selectedDate) {
        // Si hay una fecha seleccionada, filtrar solo por ese día
        const startOfDay = new Date(selectedDate)
        startOfDay.setHours(0, 0, 0, 0)

        const endOfDay = new Date(selectedDate)
        endOfDay.setHours(23, 59, 59, 999)

        query = query.gte("created_at", startOfDay.toISOString()).lte("created_at", endOfDay.toISOString())

        // Ya no usamos el rango por defecto
        setUseDefaultDateRange(false)
      } else if (useDefaultDateRange) {
        // Si no hay fecha seleccionada, usar los últimos 7 días por defecto
        const sevenDaysAgo = new Date()
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
        sevenDaysAgo.setHours(0, 0, 0, 0)

        query = query.gte("created_at", sevenDaysAgo.toISOString())
      }

      // Solo aplicar el filtro de categoría si no es "all" y no es null
      if (categoryFilter && categoryFilter !== "all") {
        query = query.eq("ingredients.category_id", categoryFilter)
      }

      // Solo aplicar el filtro de estado si no es "all" y no es null
      if (statusFilter && statusFilter !== "all") {
        query = query.eq("payment_status", statusFilter)
      }

      // Solo aplicar el filtro de tipo si no es "all" y no es null
      if (typeFilter && typeFilter !== "all") {
        query = query.eq("transaction_type", typeFilter)
      }

      // Filtros de cantidad
      if (minAmount && !isNaN(Number.parseFloat(minAmount))) {
        query = query.gte("quantity", Number.parseFloat(minAmount))
      }

      if (maxAmount && !isNaN(Number.parseFloat(maxAmount))) {
        query = query.lte("quantity", Number.parseFloat(maxAmount))
      }

      // Ordenamiento
      switch (sortBy) {
        case "date-asc":
          query = query.order("created_at", { ascending: true })
          break
        case "date-desc":
          query = query.order("created_at", { ascending: false })
          break
        case "amount-asc":
          query = query.order("quantity", { ascending: true })
          break
        case "amount-desc":
          query = query.order("quantity", { ascending: false })
          break
        case "cost-asc":
          query = query.order("total_cost", { ascending: true })
          break
        case "cost-desc":
          query = query.order("total_cost", { ascending: false })
          break
        default:
          query = query.order("created_at", { ascending: false })
      }

      const { data, error } = await query

      if (error) throw error

      setTransactions(data || [])
    } catch (error: any) {
      console.error("Error fetching transactions:", error)
      toast({
        variant: "destructive",
        title: "Error",
        description: `Error al cargar las transacciones: ${error.message}`,
      })
    } finally {
      setLoading(false)
    }
  }

  const fetchIngredients = async () => {
    try {
      const { data, error } = await supabase.from("ingredients").select("*").order("name")

      if (error) throw error

      setIngredients(data || [])
    } catch (error: any) {
      console.error("Error fetching ingredients:", error)
    }
  }

  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase.from("ingredient_categories").select("*").order("name")

      if (error) throw error

      setCategories(data || [])
    } catch (error: any) {
      console.error("Error fetching categories:", error)
    }
  }

  // Cargar datos iniciales
  useEffect(() => {
    fetchIngredients()
    fetchCategories()
    fetchTransactions()
  }, [])

  // Efecto separado para los filtros
  useEffect(() => {
    fetchTransactions()
  }, [selectedDate, categoryFilter, statusFilter, typeFilter, minAmount, maxAmount, sortBy])

  const handleDialogClose = () => {
    setOpenDialog(false)
    setSelectedIngredient(null)
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString()
  }

  const formatTime = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleTimeString()
  }

  const getCategoryName = (categoryId: string) => {
    const category = categories.find((cat) => cat.id === categoryId)
    return category ? category.name : "Sin categoría"
  }

  const getIngredientCategoryName = (ingredient: any) => {
    if (!ingredient) return "Sin categoría"
    if (ingredient.ingredient_categories) return ingredient.ingredient_categories.name
    if (ingredient.category_id) return getCategoryName(ingredient.category_id)
    return "Sin categoría"
  }

  const getTransactionTypeName = (type: string) => {
    switch (type) {
      case "entrada":
        return "Entrada"
      case "salida":
        return "Salida"
      case "ajuste":
        return "Ajuste"
      default:
        return type
    }
  }

  const getPaymentStatusName = (status: string) => {
    switch (status) {
      case "pagado":
        return "Pagado"
      case "pendiente":
        return "Pendiente"
      default:
        return status
    }
  }

  const updatePaymentStatus = async (transactionId: string, currentStatus: string) => {
    try {
      const newStatus = currentStatus === "pagado" ? "pendiente" : "pagado"

      const { error } = await supabase
        .from("ingredient_transactions")
        .update({ payment_status: newStatus })
        .eq("id", transactionId)

      if (error) throw error

      // Actualizar la lista de transacciones localmente
      setTransactions((prevTransactions) =>
        prevTransactions.map((transaction) =>
          transaction.id === transactionId ? { ...transaction, payment_status: newStatus } : transaction,
        ),
      )

      toast({
        title: "Estado actualizado",
        description: `La transacción ahora está ${newStatus === "pagado" ? "pagada" : "pendiente de pago"}.`,
      })
    } catch (error: any) {
      console.error("Error updating payment status:", error)
      toast({
        variant: "destructive",
        title: "Error",
        description: `No se pudo actualizar el estado: ${error.message}`,
      })
    }
  }

  const resetFilters = () => {
    setSelectedDate(undefined)
    setUseDefaultDateRange(true)
    setCategoryFilter(null)
    setStatusFilter(null)
    setTypeFilter(null)
    setMinAmount("")
    setMaxAmount("")
    setSortBy("date-desc")
    setSearchTerm("")
    // Forzar actualización después de resetear los filtros
    setTimeout(() => fetchTransactions(), 100)
  }

  const handleDateChange = (date: Date | undefined) => {
    setSelectedDate(date)
    if (date) {
      setUseDefaultDateRange(false)
    }
  }

  const getActiveFiltersCount = () => {
    let count = 0
    if (selectedDate) count++
    if (categoryFilter) count++
    if (statusFilter) count++
    if (typeFilter) count++
    if (minAmount) count++
    if (maxAmount) count++
    if (sortBy !== "date-desc") count++
    return count
  }

  const getDateRangeText = () => {
    if (selectedDate) {
      return `Transacciones del ${formatDate(selectedDate.toISOString())}`
    } else if (useDefaultDateRange) {
      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
      return `Últimos 7 días (${formatDate(sevenDaysAgo.toISOString())} - ${formatDate(new Date().toISOString())})`
    } else {
      return "Todas las transacciones"
    }
  }

  const exportToCSV = () => {
    try {
      // Crear contenido CSV
      let csvContent = "Fecha,Hora,Ingrediente,Categoría,Tipo,Cantidad,Unidad,Costo Total,Costo Unitario,Estado,Notas\n"

      filteredTransactions.forEach((transaction) => {
        const row = [
          formatDate(transaction.created_at),
          formatTime(transaction.created_at),
          transaction.ingredients?.name || "Desconocido",
          getIngredientCategoryName(transaction.ingredients),
          getTransactionTypeName(transaction.transaction_type),
          transaction.quantity,
          transaction.ingredients?.unit || "unidad",
          transaction.total_cost,
          transaction.unit_cost,
          getPaymentStatusName(transaction.payment_status),
          (transaction.notes || "").replace(/,/g, ";"), // Reemplazar comas por punto y coma para evitar problemas en CSV
        ].join(",")

        csvContent += row + "\n"
      })

      // Crear blob y descargar
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.setAttribute("href", url)

      // Incluir información de filtros en el nombre del archivo
      let fileName = "transacciones_stock"
      if (selectedDate) {
        fileName += `_${formatDate(selectedDate.toISOString()).replace(/\//g, "-")}`
      } else if (useDefaultDateRange) {
        const sevenDaysAgo = new Date()
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
        fileName += `_ultimos_7_dias`
      }
      fileName += ".csv"

      link.setAttribute("download", fileName)

      link.style.visibility = "hidden"
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      toast({
        title: "Exportación completada",
        description: `Se han exportado ${filteredTransactions.length} transacciones a CSV correctamente.`,
      })
    } catch (error: any) {
      console.error("Error exporting to CSV:", error)
      toast({
        variant: "destructive",
        title: "Error",
        description: "Error al exportar las transacciones a CSV.",
      })
    }
  }

  const filteredTransactions = useMemo(() => {
    return transactions.filter((transaction) => {
      const ingredientName = transaction.ingredients?.name?.toLowerCase() || ""
      const notes = transaction.notes?.toLowerCase() || ""

      return ingredientName.includes(searchTerm.toLowerCase()) || notes.includes(searchTerm.toLowerCase())
    })
  }, [transactions, searchTerm])

  // Usar el hook de paginación
  const { currentPage, setCurrentPage, itemsPerPage, setItemsPerPage, totalPages, paginatedData } = usePagination({
    data: filteredTransactions,
    initialItemsPerPage: 10,
  })

  return (
    <Card className="shadow-md border dark:border-border">
      <CardHeader className="flex flex-row items-center justify-between bg-muted/30 dark:bg-muted/10">
        <CardTitle>Transacciones de Inventario</CardTitle>
        <Dialog open={openDialog} onOpenChange={setOpenDialog}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-2 h-4 w-4" />
              Nueva Transacción
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>Registrar Transacción de Stock</DialogTitle>
            </DialogHeader>
            <StockTransactionForm
              ingredientId={selectedIngredient || undefined}
              onSuccess={() => {
                fetchTransactions()
                fetchIngredients()
                handleDialogClose()
              }}
            />
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-6">
        <div className="space-y-4">
          {/* Barra de búsqueda y filtros */}
          <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
            <div className="flex items-center w-full md:w-auto">
              <div className="relative w-full md:w-80">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por ingrediente o notas..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-10"
                />
                {searchTerm && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 transform -translate-y-1/2 h-7 w-7"
                    onClick={() => setSearchTerm("")}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 items-center">
              {/* Selector de fecha */}
              <div className="flex items-center gap-2">
                <div className="w-[180px]">
                  <DatePicker
                    date={selectedDate}
                    setDate={handleDateChange}
                    placeholder="Seleccionar fecha"
                    className="w-full"
                  />
                </div>
                {selectedDate && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => {
                      setSelectedDate(undefined)
                      setUseDefaultDateRange(true)
                    }}
                    title="Mostrar últimos 7 días"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>

              {/* Botón de filtros avanzados */}
              <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9">
                    <Filter className="mr-2 h-4 w-4" />
                    <span>Filtros</span>
                    {getActiveFiltersCount() > 0 && (
                      <Badge className="ml-2 bg-primary text-primary-foreground">{getActiveFiltersCount()}</Badge>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80" align="end">
                  <div className="space-y-4">
                    <h4 className="font-medium">Filtros avanzados</h4>
                    <Separator />

                    <div className="space-y-2">
                      <label className="text-sm font-medium">Categoría</label>
                      <Select
                        value={categoryFilter || ""}
                        onValueChange={(value) => setCategoryFilter(value === "all" ? null : value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Todas las categorías" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todas las categorías</SelectItem>
                          {categories.map((category) => (
                            <SelectItem key={category.id} value={category.id}>
                              {category.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">Estado</label>
                      <Select
                        value={statusFilter || ""}
                        onValueChange={(value) => setStatusFilter(value === "all" ? null : value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Todos los estados" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todos los estados</SelectItem>
                          <SelectItem value="pagado">Pagado</SelectItem>
                          <SelectItem value="pendiente">Pendiente</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">Tipo</label>
                      <Select
                        value={typeFilter || ""}
                        onValueChange={(value) => setTypeFilter(value === "all" ? null : value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Todos los tipos" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todos los tipos</SelectItem>
                          <SelectItem value="entrada">Entrada</SelectItem>
                          <SelectItem value="salida">Salida</SelectItem>
                          <SelectItem value="ajuste">Ajuste</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">Rango de cantidad</label>
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          placeholder="Mínimo"
                          value={minAmount}
                          onChange={(e) => setMinAmount(e.target.value)}
                          className="w-1/2"
                        />
                        <Input
                          type="number"
                          placeholder="Máximo"
                          value={maxAmount}
                          onChange={(e) => setMaxAmount(e.target.value)}
                          className="w-1/2"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">Ordenar por</label>
                      <Select value={sortBy} onValueChange={setSortBy}>
                        <SelectTrigger>
                          <SelectValue placeholder="Ordenar por" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="date-desc">Fecha (más reciente)</SelectItem>
                          <SelectItem value="date-asc">Fecha (más antigua)</SelectItem>
                          <SelectItem value="amount-desc">Cantidad (mayor a menor)</SelectItem>
                          <SelectItem value="amount-asc">Cantidad (menor a mayor)</SelectItem>
                          <SelectItem value="cost-desc">Costo (mayor a menor)</SelectItem>
                          <SelectItem value="cost-asc">Costo (menor a mayor)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex justify-between pt-2">
                      <Button variant="outline" size="sm" onClick={resetFilters}>
                        Restablecer
                      </Button>
                      <Button size="sm" onClick={() => setFiltersOpen(false)}>
                        Aplicar filtros
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>

              {/* Botón de exportar */}
              <Button variant="outline" size="sm" className="h-9" onClick={exportToCSV}>
                <FileDown className="mr-2 h-4 w-4" />
                Exportar CSV
              </Button>
            </div>
          </div>

          {/* Indicador de rango de fechas activo */}
          <div className="flex items-center gap-2 text-sm">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span>{getDateRangeText()}</span>
            {!useDefaultDateRange && !selectedDate && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => {
                  setUseDefaultDateRange(true)
                  fetchTransactions()
                }}
              >
                Volver a últimos 7 días
              </Button>
            )}
          </div>

          {/* Indicadores de filtros activos */}
          {getActiveFiltersCount() > 0 && (
            <div className="flex flex-wrap gap-2 items-center">
              {categoryFilter && (
                <Badge variant="outline" className="flex items-center gap-1 dark:border-border">
                  <span>Categoría: {getCategoryName(categoryFilter)}</span>
                  <Button variant="ghost" size="icon" className="h-4 w-4 ml-1" onClick={() => setCategoryFilter(null)}>
                    <X className="h-3 w-3" />
                  </Button>
                </Badge>
              )}
              {statusFilter && (
                <Badge variant="outline" className="flex items-center gap-1 dark:border-border">
                  <span>Estado: {getPaymentStatusName(statusFilter)}</span>
                  <Button variant="ghost" size="icon" className="h-4 w-4 ml-1" onClick={() => setStatusFilter(null)}>
                    <X className="h-3 w-3" />
                  </Button>
                </Badge>
              )}
              {typeFilter && (
                <Badge variant="outline" className="flex items-center gap-1 dark:border-border">
                  <span>Tipo: {getTransactionTypeName(typeFilter)}</span>
                  <Button variant="ghost" size="icon" className="h-4 w-4 ml-1" onClick={() => setTypeFilter(null)}>
                    <X className="h-3 w-3" />
                  </Button>
                </Badge>
              )}
              {(minAmount || maxAmount) && (
                <Badge variant="outline" className="flex items-center gap-1 dark:border-border">
                  <span>
                    Cantidad: {minAmount ? `Min ${minAmount}` : ""} {maxAmount ? `Max ${maxAmount}` : ""}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4 ml-1"
                    onClick={() => {
                      setMinAmount("")
                      setMaxAmount("")
                    }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </Badge>
              )}
              {sortBy !== "date-desc" && (
                <Badge variant="outline" className="flex items-center gap-1 dark:border-border">
                  <span>
                    Ordenado por:{" "}
                    {sortBy === "date-asc"
                      ? "Fecha (más antigua)"
                      : sortBy === "amount-desc"
                        ? "Cantidad (mayor a menor)"
                        : sortBy === "amount-asc"
                          ? "Cantidad (menor a mayor)"
                          : sortBy === "cost-desc"
                            ? "Costo (mayor a menor)"
                            : "Costo (menor a mayor)"}
                  </span>
                  <Button variant="ghost" size="icon" className="h-4 w-4 ml-1" onClick={() => setSortBy("date-desc")}>
                    <X className="h-3 w-3" />
                  </Button>
                </Badge>
              )}
              <Button variant="ghost" size="sm" onClick={resetFilters} className="text-xs h-7 px-2">
                <RefreshCw className="h-3 w-3 mr-1" />
                Limpiar todos
              </Button>
            </div>
          )}

          {/* Contador de resultados */}
          <div className="text-sm text-muted-foreground">{filteredTransactions.length} transacciones encontradas</div>

          {/* Tabla de resultados */}
          {loading ? (
            <div className="rounded-md border overflow-hidden dark:border-border">
              <div className="bg-muted/30 dark:bg-muted/10 p-4">
                <Skeleton className="h-6 w-48 mb-2" />
                <Skeleton className="h-4 w-64" />
              </div>
              <div className="p-4">
                <div className="space-y-4">
                  <div className="flex flex-col space-y-2">
                    <div className="flex justify-between">
                      <Skeleton className="h-5 w-32" />
                      <Skeleton className="h-5 w-24" />
                    </div>
                    <div className="flex justify-between">
                      <Skeleton className="h-5 w-36" />
                      <Skeleton className="h-5 w-20" />
                    </div>
                    <div className="flex justify-between">
                      <Skeleton className="h-5 w-28" />
                      <Skeleton className="h-5 w-28" />
                    </div>
                  </div>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          <Skeleton className="h-4 w-16" />
                        </TableHead>
                        <TableHead>
                          <Skeleton className="h-4 w-24" />
                        </TableHead>
                        <TableHead>
                          <Skeleton className="h-4 w-16" />
                        </TableHead>
                        <TableHead>
                          <Skeleton className="h-4 w-20" />
                        </TableHead>
                        <TableHead>
                          <Skeleton className="h-4 w-24" />
                        </TableHead>
                        <TableHead>
                          <Skeleton className="h-4 w-24" />
                        </TableHead>
                        <TableHead>
                          <Skeleton className="h-4 w-16" />
                        </TableHead>
                        <TableHead>
                          <Skeleton className="h-4 w-16" />
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <Skeleton className="h-4 w-24" />
                          </TableCell>
                          <TableCell>
                            <div>
                              <Skeleton className="h-4 w-32 mb-1" />
                              <Skeleton className="h-3 w-20" />
                            </div>
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-6 w-20 rounded-full" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-4 w-16" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-4 w-20" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-4 w-20" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-6 w-20 rounded-full" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-8 w-8 rounded-full" />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="text-center py-8 border rounded-lg bg-muted/20 dark:bg-muted/5 dark:border-border">
              <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <Search className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="mt-4 text-lg font-medium">No se encontraron transacciones</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {searchTerm
                  ? "Intenta con otros términos de búsqueda o ajusta los filtros"
                  : "Ajusta los filtros o agrega nuevas transacciones"}
              </p>
              <Button variant="outline" className="mt-4" onClick={resetFilters}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Restablecer filtros
              </Button>
            </div>
          ) : (
            <>
              <div className="rounded-md border overflow-hidden dark:border-border">
                <Table>
                  <TableHeader className="bg-muted/30 dark:bg-muted/10">
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Ingrediente</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Cantidad</TableHead>
                      <TableHead>Costo Total</TableHead>
                      <TableHead>Costo Unitario</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Notas</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedData.map((transaction) => (
                      <TableRow key={transaction.id} className="hover:bg-muted/20 dark:hover:bg-muted/10">
                        <TableCell>
                          {formatDate(transaction.created_at)}
                          <div className="text-xs text-muted-foreground">{formatTime(transaction.created_at)}</div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{transaction.ingredients?.name || "Desconocido"}</div>
                          <div className="text-xs text-muted-foreground">
                            {getIngredientCategoryName(transaction.ingredients)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              transaction.transaction_type === "entrada"
                                ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800"
                                : transaction.transaction_type === "salida"
                                  ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800"
                                  : "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800"
                            }
                          >
                            {getTransactionTypeName(transaction.transaction_type)}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">
                          {transaction.quantity} {transaction.ingredients?.unit || "unidades"}
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(transaction.total_cost)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(transaction.unit_cost)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className={
                                transaction.payment_status === "pendiente"
                                  ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-800"
                                  : "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800"
                              }
                            >
                              {getPaymentStatusName(transaction.payment_status)}
                            </Badge>

                            {transaction.transaction_type !== "salida" && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 rounded-full"
                                      onClick={() => updatePaymentStatus(transaction.id, transaction.payment_status)}
                                    >
                                      {transaction.payment_status === "pendiente" ? (
                                        <CheckCircle className="h-4 w-4 text-green-600" />
                                      ) : (
                                        <Clock className="h-4 w-4 text-yellow-600" />
                                      )}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>
                                      {transaction.payment_status === "pendiente"
                                        ? "Marcar como pagado"
                                        : "Marcar como pendiente"}
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {transaction.notes ? (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => {
                                      setSelectedNotes(transaction.notes)
                                      setNotesDialogOpen(true)
                                    }}
                                  >
                                    <FileText className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Ver notas</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : (
                            <span className="text-muted-foreground text-sm">Sin notas</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Paginación */}
              <div className="flex items-center justify-between mt-4">
                <ItemsPerPage itemsPerPage={itemsPerPage} onChange={setItemsPerPage} options={[10, 25, 50, 100]} />
                <div className="text-sm text-muted-foreground">
                  Mostrando {paginatedData.length} de {filteredTransactions.length} transacciones
                </div>
                <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
              </div>
            </>
          )}
        </div>
      </CardContent>
      {/* Diálogo para mostrar notas */}
      <Dialog open={notesDialogOpen} onOpenChange={setNotesDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Notas de la transacción</DialogTitle>
          </DialogHeader>
          <div className="p-4 bg-muted/50 rounded-md max-h-[300px] overflow-y-auto dark:bg-muted/20">
            {selectedNotes || "Sin notas"}
          </div>
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setNotesDialogOpen(false)}>
              Cerrar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
