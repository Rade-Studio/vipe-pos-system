import { create } from "zustand"
import { persist } from "zustand/middleware"
import businessConfigService from "@/lib/supabase/business-config-service"

type ConfigState = {
  // Impuestos y propinas
  tipPercentage: number
  taxPercentage: number
  priceSuggestion: number

  // Control de inventario
  inventoryControlEnabled: boolean
  setInventoryControlEnabled: (enabled: boolean) => void

  // Acciones
  setTipPercentage: (percentage: number) => void
  setTaxPercentage: (percentage: number) => void
  setPriceSuggestion: (porcentaje: number) => void

  // Información del negocio para facturas
  businessName: string
  businessAddress: string
  businessPhone: string
  businessNIT: string

  // Contraseñas de perfiles
  kitchenPassword: string
  cashierPassword: string
  adminPassword: string
  waiterPassword: string

  // Acciones para información del negocio
  setBusinessInfo: (info: {
    name?: string
    address?: string
    phone?: string
    nit?: string
  }) => void

  // Acciones para contraseñas
  setProfilePasswords: (passwords: {
    kitchen?: string
    cashier?: string
    admin?: string
    waiter?: string
  }) => void

  // Estado de carga
  isLoading: boolean
  error: string | null

  // Acciones para sincronización con la base de datos
  loadConfigFromDB: () => Promise<void>
  saveConfigToDB: () => Promise<void>
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set, get) => ({
      // Valores por defecto
      tipPercentage: 10,
      taxPercentage: 8,
      inventoryControlEnabled: false,
      businessName: "Restaurante Demo",
      businessAddress: "Calle Principal #123, Ciudad",
      businessPhone: "123-456-7890",
      businessNIT: "900.123.456-7",
      kitchenPassword: "1234",
      cashierPassword: "5678",
      adminPassword: "9999",
      waiterPassword: "0000",
      isLoading: false,
      error: null,
      priceSuggestion: 300,

      // Acciones
      setTipPercentage: (percentage: number) => set({ tipPercentage: percentage }),
      setTaxPercentage: (percentage: number) => set({ taxPercentage: percentage }),
      setPriceSuggestion: (percentage: number) => set({ priceSuggestion: percentage }),
      setInventoryControlEnabled: (enabled: boolean) => set({ inventoryControlEnabled: enabled }),
      setBusinessInfo: (info) =>
        set((state) => ({
          businessName: info.name ?? state.businessName,
          businessAddress: info.address ?? state.businessAddress,
          businessPhone: info.phone ?? state.businessPhone,
          businessNIT: info.nit ?? state.businessNIT,
        })),
      setProfilePasswords: (passwords) =>
        set((state) => ({
          kitchenPassword: passwords.kitchen ?? state.kitchenPassword,
          cashierPassword: passwords.cashier ?? state.cashierPassword,
          adminPassword: passwords.admin ?? state.adminPassword,
          waiterPassword: passwords.waiter ?? state.waiterPassword,
        })),

      // Cargar configuración desde la base de datos
      loadConfigFromDB: async () => {
        try {
          set({ isLoading: true, error: null })

          // Inicializar configuración por defecto si no existe
          await businessConfigService.initializeDefaultConfig()

          // Obtener toda la configuración
          const config = await businessConfigService.getAllConfig()

          set({
            tipPercentage: config.tip_percentage,
            taxPercentage: config.tax_percentage,
            priceSuggestion: config.price_suggestion,
            inventoryControlEnabled: config.inventory_control_enabled,
            businessName: config.business_name,
            businessAddress: config.business_address,
            businessPhone: config.business_phone,
            businessNIT: config.business_nit,
            kitchenPassword: config.kitchen_password,
            cashierPassword: config.cashier_password,
            adminPassword: config.admin_password,
            waiterPassword: config.waiter_password,
            isLoading: false,
          })

          console.log("Configuración cargada desde la base de datos:", config)
        } catch (error) {
          console.error("Error al cargar configuración:", error)
          set({
            isLoading: false,
            error: error instanceof Error ? error.message : "Error desconocido al cargar configuración",
          })
        }
      },

      // Guardar configuración en la base de datos
      saveConfigToDB: async () => {
        try {
          set({ isLoading: true, error: null })
          const state = get()

          const configToSave = {
            tip_percentage: state.tipPercentage,
            tax_percentage: state.taxPercentage,
            price_suggestion: state.priceSuggestion,
            inventory_control_enabled: state.inventoryControlEnabled,
            business_name: state.businessName,
            business_address: state.businessAddress,
            business_phone: state.businessPhone,
            business_nit: state.businessNIT,
            kitchen_password: state.kitchenPassword,
            cashier_password: state.cashierPassword,
            admin_password: state.adminPassword,
            waiter_password: state.waiterPassword,
          }

          await businessConfigService.saveMultipleConfig(configToSave)

          set({ isLoading: false })

          console.log("Configuración guardada en la base de datos")
        } catch (error) {
          console.error("Error al guardar configuración:", error)
          set({
            isLoading: false,
            error: error instanceof Error ? error.message : "Error desconocido al guardar configuración",
          })
        }
      },
    }),
    {
      name: "pos-config-storage",
    },
  ),
)
