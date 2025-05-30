"use client"

import { useState, useEffect } from "react"
import { ProfileSelection } from "@/components/profiles/ProfileSelection"
import { WaiterView } from "@/components/views/WaiterView"
import { KitchenView } from "@/components/views/KitchenView"
import { CashierView } from "@/components/views/CashierView"
import { AdminView } from "@/components/views/AdminView"
import { LoginView } from "@/components/auth/LoginView"
import { useProfile } from "@/hooks/use-profile"
import { Loader2 } from "lucide-react"
import { useConfigStore } from "@/store/use-config-store"
import { usePOSStore } from "@/store/use-pos-store"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { supabase } from "@/lib/supabase/client"
import {repositories} from "@/lib";
import {Order} from "@/types";

export default function Home() {
  const { profiles, selectedProfile, showProfileSelection, selectProfile, changeProfile } = useProfile()
  const { setTables, setProfiles } = usePOSStore()
  const { loadCurrentRegister } = useCashRegisterStore()
  const [isLoading, setIsLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const { loadConfigFromDB } = useConfigStore()

  // Verificar estado de autenticación al cargar la página
  useEffect(() => {
    const checkAuth = async () => {
      const { data } = await supabase.auth.getSession()
      setIsAuthenticated(!!data.session)

      // Suscribirse a cambios en la autenticación
      const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
        setIsAuthenticated(!!session)
      })

      return () => {
        authListener.subscription.unsubscribe()
      }
    }

    checkAuth()
  }, [])

  // Cargar la configuración al iniciar la aplicación
  useEffect(() => {
    const initApp = async () => {
      try {
        // Solo cargar datos si el usuario está autenticado
        if (!isAuthenticated) {
          setIsLoading(false)
          return
        }

        // Cargar la configuración desde la base de datos
        await loadConfigFromDB()

        // Cargar mesas
        const tablesData = await repositories.tables.getAll()
        const formattedTables = tablesData.map((table) => ({
          id: table.id,
          number: table.number,
          status: table.status as any,
          waiter: table.waiter_id || undefined,
        }))
        setTables(formattedTables)

        // Cargar meseros
        const waitersData = await repositories.profiles.getByRole("waiter", true)
        setProfiles(waitersData)

        // Cargar órdenes activas
        await loadActiveOrders()

        // Cargar información de caja actual
        await loadCurrentRegister()

      } catch (error) {
      } finally {
        // Finalizar la carga después de un breve retraso para mostrar la pantalla de carga
        setTimeout(() => {
          setIsLoading(false)
        }, 500)
      }
    }

    async function loadActiveOrders() {
      try {
        // Cargar órdenes en cocina y entregadas
        const kitchenOrders = await repositories.orders.getByStatusWithItems("kitchen")
        const deliveredOrders = await repositories.orders.getByStatusWithItems("delivered")

        // Combinar las órdenes
        const dbOrders = [...kitchenOrders, ...deliveredOrders]

        // Convertir las órdenes de la base de datos al formato que espera el store
        const storeOrders = dbOrders.map((dbOrder) => {
          // Convertir los items de la orden
          const items = dbOrder.order_items.map((item) => ({
            id: `item-${item.id}`,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            comments: item.comments || undefined,
            categoryId: item.categoryId || "",
          }))

          // Crear el objeto de orden para el store
          return {
            id: dbOrder.id,
            tableId: dbOrder.table_id,
            items,
            status: dbOrder.status as any,
            bill: {
              subtotal: dbOrder.bill.subtotal,
              tax: dbOrder.bill.tax,
              taxPercentage: dbOrder.bill.taxPercentage,
              tip: dbOrder.bill.tip,
              tipPercentage: dbOrder.bill.tipPercentage,
              total: dbOrder.bill.total,
            },
            waiter: dbOrder.waiter_id,
            createdAt: new Date(dbOrder.created_at),
            isPartialOrder: dbOrder.is_partial_order || false,
            parentOrderId: dbOrder.parentOrderId || null,
          }
        })

        // Actualizar el store con las órdenes
        usePOSStore.getState().setOrders(storeOrders as Order[])
      } catch (error) {
        console.error("Error al cargar órdenes activas:", error)
      }
    }

    if (isAuthenticated) {
      initApp()
    } else {
      setIsLoading(false)
    }
  }, [loadConfigFromDB, setTables, setProfiles, loadCurrentRegister, isAuthenticated])

  // Pantalla de carga mientras se inicializa la aplicación
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Cargando Sistema POS</h1>
          <p className="text-muted-foreground">Inicializando configuración...</p>
        </div>
      </div>
    )
  }

  // Pantalla de login si no está autenticado
  if (!isAuthenticated) {
    return <LoginView onLoginSuccess={() => setIsAuthenticated(true)} />
  }

  // Profile selection screen
  if (showProfileSelection) {
    return <ProfileSelection profiles={profiles} onSelectProfile={selectProfile} />
  }

  // Render the appropriate view based on the selected profile role
  if (selectedProfile?.role === "waiter") {
    return <WaiterView profile={selectedProfile} onChangeProfile={changeProfile} />
  }

  if (selectedProfile?.role === "kitchen") {
    return <KitchenView profile={selectedProfile} onChangeProfile={changeProfile} />
  }

  if (selectedProfile?.role === "cashier") {
    return <CashierView profile={selectedProfile} onChangeProfile={changeProfile} />
  }

  if (selectedProfile?.role === "admin") {
    return <AdminView profile={selectedProfile} onChangeProfile={changeProfile} />
  }

  // Fallback (should never happen)
  return <div>Error: Perfil no válido</div>
}
