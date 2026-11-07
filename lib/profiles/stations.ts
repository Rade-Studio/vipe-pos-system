import type { CashRegister, Order, ProfileRole, Table } from "@/types"

/**
 * Stations of the admin "Cambiar Perfil" launcher (design/profile-select/02),
 * in shortcut order: the key of each station is its index + 1.
 */
export const STATIONS: readonly { role: ProfileRole; name: string; purpose: string }[] = [
  { role: "waiter", name: "Mesero", purpose: "Tomar pedidos por mesa" },
  { role: "kitchen", name: "Cocina", purpose: "Ver y despachar comandas" },
  { role: "cashier", name: "Caja", purpose: "Cobrar y cerrar el turno" },
  { role: "delivery_operator", name: "Domicilios", purpose: "Despachar pedidos a domicilio" },
  { role: "admin", name: "Administrador", purpose: "Configurar y supervisar" },
]

export interface StationSources {
  tables: Table[]
  orders: Order[]
  registers: CashRegister[]
}

const OCCUPIED: ReadonlySet<Table["status"]> = new Set(["occupied", "kitchen", "served"])

function clock(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

/**
 * Live context line per station, derived only from what the admin's startup
 * loads already put in the stores (tables, kitchen orders, registers). An
 * empty source yields no line: an empty store cannot tell "none" from "not
 * loaded". Delivery has no loaded source, so it never gets a line.
 */
export function stationCounts({ tables, orders, registers }: StationSources): Partial<Record<ProfileRole, string>> {
  const counts: Partial<Record<ProfileRole, string>> = {}
  if (tables.length > 0) {
    const occupied = tables.filter((t) => OCCUPIED.has(t.status)).length
    counts.waiter = `${tables.length} mesas · ${occupied} ocupadas`
  }
  const inKitchen = orders.filter((o) => o.status === "kitchen").length
  if (inKitchen > 0) counts.kitchen = `${inKitchen} ${inKitchen === 1 ? "comanda" : "comandas"} en cocina`
  if (registers.length > 0) {
    const open = registers.find((r) => r.status === "open")
    counts.cashier = open ? `Caja abierta · desde ${clock(new Date(open.openingTimestamp))}` : "Caja cerrada"
  }
  return counts
}
