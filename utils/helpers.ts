import { Promotion } from "@/types/models"

// Verificar la función getStatusColor para asegurar que el estado "kitchen" tenga el color correcto
export function getStatusColor(status: string): string {
  switch (status) {
    case "available":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
    case "reserved":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
    case "occupied":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
    case "kitchen":
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
    case "delivered":
    case "served": // Añadir "served" como alias de "delivered"
      return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300"
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300"
  }
}

export function getStatusLabel(status: string): string {
  switch (status) {
    case "available":
      return "Disponible"
    case "reserved":
      return "Reservada"
    case "occupied":
      return "Ocupada"
    case "kitchen":
      return "En cocina"
    case "delivered":
    case "served": // Añadir "served" como alias de "delivered"
      return "Servida"
    default:
      return "Desconocido"
  }
}

// Función para formatear moneda
// Verificar la función formatCurrency para asegurar que use el formato colombiano con puntos de miles
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(amount)
}

// Función para formatear fecha
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "Fecha no disponible"

  try {
    const dateObj = typeof date === "string" ? new Date(date) : date

    // Verificar si la fecha es válida
    if (isNaN(dateObj.getTime())) {
      return "Fecha inválida"
    }

    return new Intl.DateTimeFormat("es-CO", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(dateObj)
  } catch (error) {
    console.error("Error al formatear fecha:", error)
    return "Error de formato"
  }
}

// Función para formatear fecha corta
export function formatShortDate(date: Date | string | null | undefined): string {
  if (!date) return "N/A"

  try {
    const dateObj = typeof date === "string" ? new Date(date) : date

    // Verificar si la fecha es válida
    if (isNaN(dateObj.getTime())) {
      return "N/A"
    }

    return new Intl.DateTimeFormat("es-CO", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(dateObj)
  } catch (error) {
    console.error("Error al formatear fecha corta:", error)
    return "N/A"
  }
}

// Función para formatear hora
export function formatTime(date: Date | string | null | undefined): string {
  if (!date) return "N/A"

  try {
    const dateObj = typeof date === "string" ? new Date(date) : date

    // Verificar si la fecha es válida
    if (isNaN(dateObj.getTime())) {
      return "N/A"
    }

    return new Intl.DateTimeFormat("es-CO", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(dateObj)
  } catch (error) {
    console.error("Error al formatear hora:", error)
    return "N/A"
  }
}

// Función para formatear fecha y hora
export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "N/A"

  try {
    const dateObj = typeof date === "string" ? new Date(date) : date

    // Verificar si la fecha es válida
    if (isNaN(dateObj.getTime())) {
      return "N/A"
    }

    return new Intl.DateTimeFormat("es-CO", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(dateObj)
  } catch (error) {
    console.error("Error al formatear fecha y hora:", error)
    return "N/A"
  }
}

/**
 * Calcula el descuento para un plato dado una promoción.
 * @param price El precio original del plato.
 * @param promotion La promoción a aplicar.
 * @returns El monto del descuento.
 */
export function calculateDiscount(price: number, promotion: Promotion): number {
  if (promotion.discount_type === "percentage") {
    return Math.round((price * (promotion.discount_value ?? 1)) / 100);
  } else {
    return Math.min(price, promotion.discount_value ?? 0); // El descuento no puede ser mayor que el precio
  }
}
