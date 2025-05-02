"use client"

import { toast as toastFunction } from "@/components/ui/use-toast"

type ToastType = "success" | "error" | "warning" | "info"

interface ToastOptions {
  title?: string
  description: string
  duration?: number
}

const createToast = (type: ToastType, options: string | ToastOptions) => {
  let title = ""
  let description = ""
  let duration = 3000

  if (typeof options === "string") {
    description = options
  } else {
    title = options.title || ""
    description = options.description
    duration = options.duration || 3000
  }

  switch (type) {
    case "success":
      title = title || "Éxito"
      break
    case "error":
      title = title || "Error"
      break
    case "warning":
      title = title || "Advertencia"
      break
    case "info":
      title = title || "Información"
      break
  }

  toastFunction({
    title,
    description,
    duration,
    variant: type === "error" ? "destructive" : "default",
  })
}

export const toast = {
  success: (options: string | ToastOptions) => createToast("success", options),
  error: (options: string | ToastOptions) => createToast("error", options),
  warning: (options: string | ToastOptions) => createToast("warning", options),
  info: (options: string | ToastOptions) => createToast("info", options),
}
