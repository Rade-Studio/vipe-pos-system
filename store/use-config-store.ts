import { create } from "zustand"
import { persist } from "zustand/middleware"
import { fetchConfig, saveConfig } from "@/lib/api/config"
import { log } from "@/lib/log"

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




  // Acciones para información del negocio
  setBusinessInfo: (info: {
    name?: string
    address?: string
    phone?: string
    nit?: string
  }) => void



  // Estado de carga
  isLoading: boolean
  error: string | null

  // Acciones para sincronización con la base de datos. `options` is ignored
  // since T7b (`GET /config` never writes); kept for the portal's call site.
  loadConfigFromDB: (options?: { canWrite?: boolean }) => Promise<void>
  saveConfigToDB: () => Promise<void>
}

export const useConfigStore = create<ConfigState>()(
    (set, get) => ({
      // Placeholders until `GET /config` answers: the server defaults, so the
      // first render matches what the API returns for an empty config.
      tipPercentage: 10,
      taxPercentage: 10,
      inventoryControlEnabled: false,
      businessName: "Mi Restaurante",
      businessAddress: "Dirección del Restaurante",
      businessPhone: "123-456-7890",
      businessNIT: "123456789",
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
      // Cargar configuración: `GET /config` returns every key with the server
      // defaults filled, so no role seeds missing keys any more.
      loadConfigFromDB: async () => {
        try {
          set({ isLoading: true, error: null })

          const config = await fetchConfig()

          set({
            tipPercentage: config.tipPercentage,
            taxPercentage: config.taxPercentage,
            priceSuggestion: config.priceSuggestion,
            inventoryControlEnabled: config.inventoryControlEnabled,
            businessName: config.businessName,
            businessAddress: config.businessAddress,
            businessPhone: config.businessPhone,
            businessNIT: config.businessNit,
            isLoading: false,
          })

        } catch (error) {
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

          // One `PUT /config`: the server upserts every key in one transaction.
          await saveConfig({
            tipPercentage: state.tipPercentage,
            taxPercentage: state.taxPercentage,
            priceSuggestion: state.priceSuggestion,
            inventoryControlEnabled: state.inventoryControlEnabled,
            businessName: state.businessName,
            businessAddress: state.businessAddress,
            businessPhone: state.businessPhone,
            businessNit: state.businessNIT,
          })

          set({ isLoading: false })

          log.info("Configuración guardada en la base de datos")
        } catch (error) {
          log.error("Error al guardar configuración:", { error: String(error) })
          set({
            isLoading: false,
            error: error instanceof Error ? error.message : "Error desconocido al guardar configuración",
          })
        }
      },
    }),
)
