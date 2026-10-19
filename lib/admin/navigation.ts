/**
 * Admin dashboard section registry and hash routing (odd/tasks/admin-dashboard-inventario.md,
 * "Admin shell"). The section lives in the URL hash (`#inventory/items`) so a
 * reload or the browser back button keeps it; no Next `useSearchParams`.
 *
 * Pure data and functions only: icons and page components are attached in
 * `components/admin/shell`.
 */

export type AdminNavGroupId = "general" | "catalog" | "inventory" | "settings"

export interface AdminNavGroup {
  id: AdminNavGroupId
  label: string
}

export const ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = [
  { id: "general", label: "General" },
  { id: "catalog", label: "Catálogo" },
  { id: "inventory", label: "Inventario" },
  { id: "settings", label: "Configuración" },
]

export const ADMIN_SECTIONS = [
  { id: "overview", group: "general", label: "Resumen", description: "Ventas, cocina, mesas y personal de un vistazo." },
  { id: "orders", group: "general", label: "Órdenes", description: "Órdenes en curso y completadas." },
  { id: "tables", group: "general", label: "Mesas", description: "Estado y asignación de mesas." },
  { id: "cash", group: "general", label: "Caja", description: "Resumen, transacciones e historial de cajas." },
  { id: "menu", group: "catalog", label: "Menú", description: "Categorías, platos y promociones." },
  { id: "formulas", group: "catalog", label: "Fórmulas", description: "Recetas de platos y preparaciones." },
  { id: "inventory/overview", group: "inventory", label: "Resumen", description: "Indicadores de inventario." },
  { id: "inventory/items", group: "inventory", label: "Artículos", description: "Catálogo de artículos e insumos." },
  { id: "inventory/movements", group: "inventory", label: "Movimientos", description: "Entradas, salidas y ajustes." },
  { id: "inventory/purchases", group: "inventory", label: "Compras", description: "Proveedores y órdenes de compra." },
  { id: "inventory/production", group: "inventory", label: "Producción", description: "Lotes de preparaciones." },
  { id: "inventory/counts", group: "inventory", label: "Conteos", description: "Conteos físicos y mermas." },
  { id: "inventory/locations", group: "inventory", label: "Bodegas", description: "Bodegas y ubicaciones." },
  { id: "settings/business", group: "settings", label: "Negocio", description: "Datos que aparecen en facturas y comandas." },
  { id: "settings/taxes", group: "settings", label: "Impuestos y propinas", description: "Porcentajes aplicados a cada cuenta." },
  { id: "settings/inventory", group: "settings", label: "Inventario", description: "Control automático de stock." },
  { id: "settings/payment-methods", group: "settings", label: "Métodos de pago", description: "Medios de pago aceptados." },
  { id: "settings/delivery", group: "settings", label: "Domicilios", description: "Repartidores y tarifa de domicilio." },
  { id: "settings/staff", group: "settings", label: "Personal", description: "Usuarios y roles del equipo." },
] as const satisfies readonly { id: string; group: AdminNavGroupId; label: string; description: string }[]

export type AdminSection = (typeof ADMIN_SECTIONS)[number]
export type AdminSectionId = AdminSection["id"]

export const DEFAULT_ADMIN_SECTION: AdminSectionId = "overview"

const SECTION_BY_ID = new Map<string, AdminSection>(ADMIN_SECTIONS.map((section) => [section.id, section]))

export function isAdminSectionId(value: string): value is AdminSectionId {
  return SECTION_BY_ID.has(value)
}

export function getAdminSection(id: AdminSectionId): AdminSection {
  return SECTION_BY_ID.get(id) as AdminSection
}

export function sectionsInGroup(groupId: AdminNavGroupId): AdminSection[] {
  return ADMIN_SECTIONS.filter((section) => section.group === groupId)
}

export function groupOfSection(id: AdminSectionId): AdminNavGroup {
  const groupId = getAdminSection(id).group
  return ADMIN_NAV_GROUPS.find((group) => group.id === groupId) as AdminNavGroup
}

/**
 * `#inventory/items` → `inventory/items`. A bare group (`#settings`) opens its
 * first section; anything unknown or malformed opens the default section.
 */
export function parseSectionHash(hash: string): AdminSectionId {
  let value = hash.trim().replace(/^#/, "")
  try {
    value = decodeURIComponent(value)
  } catch {
    return DEFAULT_ADMIN_SECTION
  }
  value = value.replace(/\/+$/, "")

  if (isAdminSectionId(value)) return value

  const group = ADMIN_NAV_GROUPS.find((candidate) => candidate.id === value)
  if (group) {
    const first = sectionsInGroup(group.id)[0]
    if (first) return first.id
  }

  return DEFAULT_ADMIN_SECTION
}

export function serializeSectionHash(id: AdminSectionId): string {
  return `#${id}`
}
