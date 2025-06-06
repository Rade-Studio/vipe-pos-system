"use client"

import { useState, useEffect } from "react"
import type { Profile, DailySales, PopularDish, CategorySales } from "@/types"
import { Header } from "@/components/layout/Header"
import { AdminLayout } from "@/components/admin/AdminLayout"
import { usePOSStore } from "@/store/use-pos-store"
import { SalesChart } from "@/components/admin/SalesChart"
import { PopularDishesChart } from "@/components/admin/PopularDishesChart"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { OrderCard } from "@/components/pos/OrderCard"
import { ConfigurationPanel } from "@/components/admin/ConfigurationPanel"
import { CompletedOrdersTable } from "@/components/admin/CompletedOrdersTable"
import { IngredientList } from "@/components/admin/inventory/IngredientList"
import { CategoryList } from "@/components/admin/menu/CategoryList"
import { DishList } from "@/components/admin/menu/DishList"
import { WaiterList } from "@/components/admin/staff/WaiterList"
import { DatePicker } from "@/components/ui/date-picker"
import { CashRegisterStatus } from "@/components/cashier/CashRegisterStatus"
import { RegisterHistoryTable } from "@/components/cashier/RegisterHistoryTable"
import { CashRegisterSummary } from "@/components/admin/CashRegisterSummary"
import { TransactionsByRegisterId } from "@/components/admin/TransactionsByRegisterId"
import { orderService } from "@/lib/supabase/service"
import { dashboardService } from "@/lib/supabase/dashboard-service"
import { AlertCircle, RefreshCw } from "lucide-react"
import { formatCurrency } from "@/utils/helpers"
import { LowStockIngredients } from "@/components/admin/inventory/LowStockIngredients"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TableManagementPanel } from "@/components/admin/tables/TableManagementPanel"
import { supabase } from "@/lib/supabase/client"
// Importar el componente Skeleton
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
// Importar el servicio realtime
import { realtimeService } from "@/lib/supabase/realtime-service"
import { PromotionList } from "@/components/admin/promotions/PromotionList"
import {tableService} from "@/lib/supabase-service";

interface AdminViewProps {
  profile: Profile
  onChangeProfile: () => void
}

export function AdminView({ profile, onChangeProfile }: AdminViewProps) {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date())
  const [monthSales, setMonthSales] = useState<number>(0)
  const [kitchenOrdersCount, setKitchenOrdersCount] = useState<number>(0)
  const [availableTables, setAvailableTables] = useState<number>(0)
  const [totalTables, setTotalTables] = useState<number>(0)
  const [activeWaiters, setActiveWaiters] = useState<number>(0)
  const [assignedTables, setAssignedTables] = useState<number>(0)
  const [loadingActiveOrders, setLoadingActiveOrders] = useState<boolean>(false)
  const [activeOrdersFromDB, setActiveOrdersFromDB] = useState<any[]>([])

  // Estados para los datos de las gráficas
  const [dailySales, setDailySales] = useState<DailySales[]>([])
  const [popularDishes, setPopularDishes] = useState<PopularDish[]>([])

  // Estado para controlar la carga de datos
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const { toast } = useToast()

  // Añadir estados para el manejo de realtime
  const [realtimeConnected, setRealtimeConnected] = useState<boolean>(false)
  const [newOrdersCount, setNewOrdersCount] = useState<number>(0)
  const [activeTab, setActiveTab] = useState<string>("dashboard")

  const handleChangeRegisterDetails = (registerDate: Date) => {
    setSelectedDate(registerDate)
  }

  const {
    tables,
    profiles,
    orders,
    getOrdersByStatus,
    isTableAccessibleByWaiter,
    reserveTable,
    releaseTable,
    getOrderById,
    removeOrder,
    loadOrders,
  } = usePOSStore()

  // Cargar datos del dashboard
  useEffect(() => {
    const loadDashboardData = async () => {
      try {
        setIsLoading(true)

        // Cargar estadísticas generales
        const stats = await dashboardService.getDashboardStats()
        setMonthSales(stats.monthSales)
        setKitchenOrdersCount(stats.kitchenOrdersCount)
        setAvailableTables(stats.availableTables)
        setTotalTables(stats.totalTables)
        setActiveWaiters(stats.activeWaiters)

        // Cargar datos para las gráficas
        const salesData = await dashboardService.getDailySales(30)
        const dishesData = await dashboardService.getPopularDishes(10)

        setDailySales(salesData)
        setPopularDishes(dishesData)

        // Obtener mesas asignadas a meseros
        const { data: assignedTablesData } = await supabase.from("tables").select("id").not("waiter_id", "is", null)

        setAssignedTables(assignedTablesData?.length || 0)
      } catch (error) {
        console.error("Error al cargar datos del dashboard:", error)
      } finally {
        setIsLoading(false)
      }
    }

    loadDashboardData()
  }, [])

  // Suscribirse a cambios en tiempo real
  useEffect(() => {
    let unsubscribe: (() => void) | null = null

    const setupRealtimeSubscription = async () => {
      try {
        console.log("Configurando suscripción en tiempo real para órdenes...")

        // Función para manejar cambios en órdenes
        const handleOrderChange = async (payload: any, isNewOrder?: boolean) => {
          console.log("Cambio en orden detectado:", payload.eventType, payload.new?.id)

          // Incrementar contador de nuevas órdenes si es una inserción
          if (payload.eventType === "INSERT") {
            setNewOrdersCount((prev) => prev + 1)

            // Solo mostrar toast para nuevas órdenes (información realmente necesaria)
            toast({
              title: "Nueva orden recibida",
              description: `Mesa ${payload.new.table_id}, ${payload.new.order_items?.length || 0} productos`,
            })
          }

          // Decrementar contador de nuevas órdenes si es una eliminación
          if (payload.eventType === "DELETE") {
            setNewOrdersCount((prev) => prev - 1)

            // Mostrar toast para eliminaciones de órdenes
            toast({
              title: "Orden eliminada",
              description: `Se ha eliminado la orden #${payload.old.id.substring(0, 8)}`,
            })
          }

          // Actualizar la lista de órdenes
          await loadActiveOrdersFromDB(false) // Pasar false para no mostrar toast
        }

        // Suscribirse a cambios en órdenes
        unsubscribe = realtimeService.subscribeToOrders(handleOrderChange)
        setRealtimeConnected(true)

        // Eliminar el toast de conexión
        // toast({
        //   title: "Conectado en tiempo real",
        //   description: "Las órdenes se actualizarán automáticamente",
        // })
      } catch (error) {
        console.error("Error al configurar suscripción en tiempo real:", error)
        setRealtimeConnected(false)

        // Mantener este toast ya que es un error importante que el usuario debe conocer
        toast({
          title: "Error de conexión",
          description: "No se pudo establecer la conexión en tiempo real",
          variant: "destructive",
        })
      }
    }

    setupRealtimeSubscription()

    // Limpiar suscripción al desmontar (sin mostrar toast)
    return () => {
      if (unsubscribe) {
        console.log("Cancelando suscripción en tiempo real")
        unsubscribe()
        setRealtimeConnected(false)
      }
    }
  }, [toast])

  // Cargar órdenes activas desde la base de datos
  const loadActiveOrdersFromDB = async (showToast = true) => {
    setLoadingActiveOrders(true)
    try {
      // Obtener órdenes con estado "active", "kitchen" y "delivered" de la base de datos
      const { data: dbOrders, error } = await supabase
        .from("orders")
        .select(`
        *,
        order_items(*),
        tables(number),
        profiles(full_name)
      `)
        .in("status", ["active", "kitchen", "delivered"])
        .order("created_at", { ascending: false })

      if (error) {
        throw error
      }

      console.log("Órdenes activas cargadas desde DB:", dbOrders?.length || 0)

      // Transformar los datos al formato que espera la aplicación
      const formattedOrders =
        dbOrders?.map((order) => ({
          id: order.id,
          tableId: order.table_id,
          waiter: order.waiter_id,
          status: order.status, // Mantener el estado original de la orden
          items:
            order.order_items?.map((item) => ({
              id: item.id,
              name: item.name,
              price: item.price,
              quantity: item.quantity,
              categoryId: item.category_id || "",
              image: "",
              comments: item.comments || "",
              status: item.status || "kitchen", // Estado del item
            })) || [],
          bill: {
            subtotal: order.subtotal || 0,
            tax: order.tax || 0,
            taxPercentage: order.tax_percentage || 0,
            tip: order.tip || 0,
            tipPercentage: order.tip_percentage || 0,
            total: order.total || 0,
          },
          createdAt: new Date(order.created_at),
          // Información adicional para mostrar
          tableName: order.tables?.number || "N/A",
          waiterName: order.profiles?.full_name || "Desconocido",
        })) || []

      setActiveOrdersFromDB(formattedOrders)

      // También actualizar el store con estas órdenes
      await loadOrders()

      // Resetear el contador de nuevas órdenes
      setNewOrdersCount(0)

      // Solo mostrar toast si se solicita explícitamente (actualización manual)
      if (showToast) {
        toast({
          title: "Órdenes actualizadas",
          description: `Se han cargado ${formattedOrders.length} órdenes activas`,
        })
      }
    } catch (error) {
      console.error("Error al cargar órdenes activas:", error)

      // Mantener este toast ya que es un error importante
      toast({
        title: "Error",
        description: "No se pudieron cargar las órdenes activas",
        variant: "destructive",
      })
    } finally {
      setLoadingActiveOrders(false)
    }
  }

  // Cargar órdenes activas al montar el componente y cuando se selecciona la pestaña
  useEffect(() => {
    loadActiveOrdersFromDB(false) // Pasar false para no mostrar toast en la carga inicial
  }, [])

  // Obtener órdenes activas y completadas
  const activeOrders = getOrdersByStatus(["kitchen", "delivered"])
  const paidOrders = getOrdersByStatus(["paid"])

  // Combinar órdenes del store con las de la base de datos, evitando duplicados
  const combinedActiveOrders = [...activeOrders, ...paidOrders]

  // Agregar órdenes de la base de datos que no estén ya en el store
  activeOrdersFromDB.forEach((dbOrder) => {
    if (!combinedActiveOrders.some((order) => order.id === dbOrder.id)) {
      combinedActiveOrders.push(dbOrder)
    }
  })

  // Category mapping
  const categoryMap: Record<string, string> = {
    "1": "Entradas",
    "2": "Platos Principales",
    "3": "Postres",
    "4": "Bebidas",
    "5": "Café",
  }

  // Admin can access all tables
  const checkTableAccess = () => true

  const handleDeleteOrder = async (orderId: string) => {
    try {
      // Verificar si la orden existe
      const order = getOrderById(orderId)
      if (!order) return

      // Eliminar la orden de la base de datos
      await orderService.deleteOrder(orderId)

      // Actualizar el estado local
      removeOrder(orderId)

      // Actualizar la lista de órdenes activas
      setActiveOrdersFromDB((prev) => prev.filter((order) => order.id !== orderId))
      await tableService.update(order.tableId, {
        status: "available",
        waiter_id: null,
      })

      // Mantener este toast ya que es una acción importante iniciada por el usuario
      toast({
        title: "Orden eliminada",
        description: "La orden ha sido eliminada correctamente",
      })
    } catch (error) {
      console.error("Error al eliminar la orden:", error)

      // Mantener este toast ya que es un error importante
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      })
    } finally {
      setLoadingActiveOrders(false)
    }
  }

  return (
    <AdminLayout
      profile={profile}
      onChangeProfile={onChangeProfile}
      activeTab={activeTab}
      onSelectTab={setActiveTab}
    >
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4 md:hidden">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="tables">Mesas</TabsTrigger>
          <TabsTrigger value="orders">Órdenes</TabsTrigger>
          <TabsTrigger value="cash">Caja</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard">
          {isLoading ? (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i}>
                    <CardHeader className="pb-2">
                      <Skeleton className="h-5 w-32" />
                    </CardHeader>
                    <CardContent>
                      <Skeleton className="h-8 w-24 mb-1" />
                      <Skeleton className="h-4 w-32" />
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i}>
                    <CardHeader>
                      <Skeleton className="h-6 w-40" />
                    </CardHeader>
                    <CardContent className="h-64">
                      <div className="flex items-center justify-center h-full">
                        <Skeleton className="h-full w-full rounded-md" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card>
                <CardHeader>
                  <Skeleton className="h-6 w-48" />
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <Card key={i}>
                        <CardContent className="p-4">
                          <div className="flex justify-between items-start">
                            <div>
                              <Skeleton className="h-5 w-32 mb-2" />
                              <Skeleton className="h-4 w-24" />
                            </div>
                            <Skeleton className="h-6 w-6 rounded-full" />
                          </div>
                          <div className="mt-4">
                            <Skeleton className="h-4 w-full mb-2" />
                            <Skeleton className="h-4 w-3/4" />
                          </div>
                          <Skeleton className="h-8 w-full mt-4 rounded-md" />
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Resumen general */}
              <div className="grid gap-4 md:grid-cols-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Ventas del Mes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{formatCurrency(monthSales)}</div>
                    <p className="text-xs text-muted-foreground">
                      {new Date().toLocaleDateString("es-ES", { month: "long", year: "numeric" })}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Órdenes en Cocina</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{kitchenOrdersCount}</div>
                    <p className="text-xs text-muted-foreground">Pendientes de preparación</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Mesas Disponibles</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {availableTables} / {totalTables}
                    </div>
                    <p className="text-xs text-muted-foreground">Listas para asignar</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Meseros Activos</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{activeWaiters}</div>
                    <p className="text-xs text-muted-foreground">{assignedTables} mesas asignadas</p>
                  </CardContent>
                </Card>
              </div>

              {/* Gráficas 2 columnas la primera con 3 partes y la segunda con 1 partes */}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <SalesChart data={dailySales} />
                <PopularDishesChart data={popularDishes} />
              </div>

              {/* Alertas de inventario */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <AlertCircle className="h-5 w-5 mr-2 text-red-500" />
                    Alertas de Inventario
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <LowStockIngredients />
                </CardContent>
              </Card>

              {/* Estado de mesas y meseros */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Estado de Mesas</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span>Disponibles:</span>
                        <span className="font-medium">{tables.filter((t) => t.status === "available").length}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span>Reservadas:</span>
                        <span className="font-medium">{tables.filter((t) => t.status === "reserved").length}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span>En cocina:</span>
                        <span className="font-medium">{tables.filter((t) => t.status === "kitchen").length}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span>Servidas:</span>
                        <span className="font-medium">{tables.filter((t) => t.status === "served").length}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Meseros Activos</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {profiles
                        ?.filter((p) => p.role === "waiter")
                        .map((waiter) => {
                          const assignedTables = tables.filter((t) => t.waiter === waiter.id)
                          return (
                            <div
                              key={waiter.id}
                              className="flex justify-between items-center p-2 rounded-md bg-muted/50"
                            >
                              <span className="font-medium">{waiter.name}</span>
                              <div className="flex items-center">
                                <span
                                  className={`px-2 py-1 rounded-full text-xs ${assignedTables.length > 0 ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100" : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"}`}
                                >
                                  {assignedTables.length > 0 ? `${assignedTables.length} mesas` : "Disponible"}
                                </span>
                              </div>
                            </div>
                          )
                        })}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Órdenes activas */}
              <Card>
                <CardHeader>
                  <CardTitle>Órdenes Activas</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span>En cocina:</span>
                      <span className="font-medium">{getOrdersByStatus(["kitchen"]).length}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>Entregadas (pendientes de pago):</span>
                      <span className="font-medium">{getOrdersByStatus(["delivered"]).length}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>Completadas hoy:</span>
                      <span className="font-medium">
                        {
                          getOrdersByStatus(["paid"]).filter((order) => {
                            const today = new Date()
                            const orderDate = new Date(order.createdAt)
                            return orderDate.setHours(0, 0, 0, 0) === today.setHours(0, 0, 0, 0)
                          }).length
                        }
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="tables">
          <div className="space-y-6">
            {/* Panel de gestión de mesas */}
            <TableManagementPanel />
          </div>
        </TabsContent>

        <TabsContent value="orders">
          <Tabs defaultValue="active">
            <TabsList className="mb-4">
              <TabsTrigger value="active">Órdenes Activas</TabsTrigger>
              <TabsTrigger value="completed">Órdenes Completadas</TabsTrigger>
            </TabsList>

            <TabsContent value="active">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">Órdenes en Cocina y Servidas</h2>
                <div className="flex items-center gap-2">
                  {realtimeConnected && (
                    <span className="flex items-center text-xs text-green-600 dark:text-green-400">
                      <span className="relative flex h-2 w-2 mr-1">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                      </span>
                      Tiempo real activo
                    </span>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => loadActiveOrdersFromDB(true)}
                    disabled={loadingActiveOrders}
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${loadingActiveOrders ? "animate-spin" : ""}`} />
                    <span>Actualizar</span>
                    {newOrdersCount > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 text-xs bg-red-500 text-white rounded-full">
                        {newOrdersCount}
                      </span>
                    )}
                  </Button>
                </div>
              </div>

              {loadingActiveOrders ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Card key={i} className="overflow-hidden">
                      <CardHeader className="pb-2">
                        <div className="flex justify-between">
                          <Skeleton className="h-6 w-24" />
                          <Skeleton className="h-6 w-16" />
                        </div>
                      </CardHeader>
                      <CardContent>
                        <Skeleton className="h-4 w-full mb-2" />
                        <Skeleton className="h-4 w-3/4 mb-2" />
                        <Skeleton className="h-4 w-1/2 mb-4" />
                        <div className="space-y-2">
                          {Array.from({ length: 3 }).map((_, j) => (
                            <div key={j} className="flex justify-between">
                              <Skeleton className="h-4 w-32" />
                              <Skeleton className="h-4 w-16" />
                            </div>
                          ))}
                        </div>
                        <div className="flex justify-end mt-4">
                          <Skeleton className="h-9 w-24" />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : combinedActiveOrders.length === 0 ? (
                <div className="text-center py-10 bg-muted/20 rounded-lg">
                  <p className="text-muted-foreground">No hay órdenes activas en este momento</p>
                  <Button variant="outline" size="sm" onClick={() => loadActiveOrdersFromDB(true)} className="mt-4">
                    <RefreshCw className="h-4 w-4 mr-2" />
                    <span>Verificar nuevamente</span>
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {combinedActiveOrders.map((order) => {
                    const table = tables.find((t) => t.id === order.tableId)
                    const waiter = profiles?.find((p) => p.id === order.waiter)

                    // Determinar si la orden es nueva (menos de 30 segundos)
                    const isNewOrder = new Date().getTime() - new Date(order.createdAt).getTime() < 30000

                    return (
                      <div key={order.id} className={`${isNewOrder ? "animate-pulse-light" : ""}`}>
                        <OrderCard
                          order={order}
                          table={table}
                          waiter={waiter}
                          isAdmin={true}
                          showActions={true}
                          onDelete={handleDeleteOrder}
                        />
                      </div>
                    )
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="completed">
              <div className="mb-4 flex items-center gap-2">
                <span>Filtrar por fecha:</span>
                <DatePicker date={selectedDate} onDateChange={setSelectedDate} />
              </div>
              <CompletedOrdersTable selectedDate={selectedDate} />
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="cash">
          <div className="space-y-6">
            <div className="mb-4 flex items-center gap-2">
              <span>Filtrar por fecha:</span>
              <DatePicker date={selectedDate} onDateChange={setSelectedDate} />
            </div>

            <Tabs defaultValue="summary">
              <TabsList className="mb-4">
                <TabsTrigger value="summary">Resumen</TabsTrigger>
                <TabsTrigger value="transactions">Transacciones</TabsTrigger>
              </TabsList>

              <TabsContent value="summary">
                <CashRegisterSummary selectedDate={selectedDate} />
              </TabsContent>

              <TabsContent value="transactions">
                <TransactionsByRegisterId selectedDate={selectedDate} />
              </TabsContent>
            </Tabs>

            <h2 className="text-xl font-semibold mt-8 mb-4">Historial de Aperturas de Caja</h2>
            <RegisterHistoryTable changeRegisterDetails={handleChangeRegisterDetails} />
          </div>
        </TabsContent>

        <TabsContent value="config_menu">
          <div className="space-y-6">
            <CategoryList />
            <DishList />
            <PromotionList />
          </div>
        </TabsContent>

        <TabsContent value="config_inventory">
          <div className="space-y-6">
            <IngredientList />
          </div>
        </TabsContent>

        <TabsContent value="config_personal">
          <div className="space-y-6">
            <WaiterList />
          </div>
        </TabsContent>

        <TabsContent value="config_business">
          <div className="space-y-6">
            <ConfigurationPanel />
          </div>
        </TabsContent>
      </Tabs>
    </AdminLayout>
  )
}
