"use client"

import { useToast as useToastOriginal } from "@/components/ui/use-toast"
import { toast as toastFunction } from "@/components/ui/use-toast"

export function useToast() {
  return useToastOriginal()
}

// Exportar una función toast para facilitar su uso
export const toast = {
  success: (message: string) => {
    toastFunction({
      title: "Éxito",
      description: message,
      variant: "default",
    })
  },
  error: (message: string) => {
    toastFunction({
      title: "Error",
      description: message,
      variant: "destructive",
    })
  },
  warning: (message: string) => {
    toastFunction({
      title: "Advertencia",
      description: message,
      variant: "default",
    })
  },
  info: (message: string) => {
    toastFunction({
      title: "Información",
      description: message,
      variant: "default",
    })
  },
}
