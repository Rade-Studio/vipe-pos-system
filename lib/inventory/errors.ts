/**
 * Maps a Supabase/PostgREST error from the inventory RPCs and tables to a
 * user-facing Spanish error (odd/tasks/admin-dashboard-inventario.md, T5).
 *
 * SQLSTATEs follow the migration convention: 22023 bad input, P0002 missing
 * or another tenant's row, 42501 role, P0001 business rule. A P0001 raised for
 * insufficient stock carries its shortages as jsonb text in `details`:
 * `produce_preparation` sends an array of {ingredient_id, name, unit,
 * required, available, missing}; the FEFO take sends one {ingredient_id,
 * missing} object.
 */

export interface InventoryShortage {
  itemId: string
  name: string | null
  unit: string | null
  required: number | null
  available: number | null
  missing: number
}

export class InventoryError extends Error {
  readonly code: string
  readonly shortages?: InventoryShortage[]

  constructor(code: string, message: string, shortages?: InventoryShortage[]) {
    super(message)
    this.name = 'InventoryError'
    this.code = code
    if (shortages) this.shortages = shortages
  }
}

interface ErrorLike {
  code?: unknown
  message?: unknown
  details?: unknown
}

const CYCLE_MESSAGE = 'La fórmula crea un ciclo: una preparación no puede usarse a sí misma, ni directa ni indirectamente.'

const toNumberOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

const parseShortages = (details: unknown): InventoryShortage[] | undefined => {
  if (typeof details !== 'string' || details.trim() === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(details)
  } catch {
    return undefined
  }
  const rows = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : []
  const shortages = rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && typeof (r as any).ingredient_id === 'string')
    .map((r) => ({
      itemId: r.ingredient_id as string,
      name: typeof r.name === 'string' ? r.name : null,
      unit: typeof r.unit === 'string' ? r.unit : null,
      required: toNumberOrNull(r.required),
      available: toNumberOrNull(r.available),
      missing: toNumberOrNull(r.missing) ?? 0,
    }))
  return shortages.length > 0 ? shortages : undefined
}

const formatShortages = (shortages: InventoryShortage[], serverMessage: string): string => {
  if (shortages.every((s) => s.name)) {
    const parts = shortages.map((s) => `${s.name} (faltan ${s.missing}${s.unit ? ` ${s.unit}` : ''})`)
    return `Stock insuficiente: ${parts.join(', ')}.`
  }
  // The single-item FEFO detail has no name: keep the server's own wording
  // after the function prefix.
  const tail = serverMessage.replace(/^[a-z_]+:\s*/, '').replace(/^insufficient stock:?\s*/i, '')
  return tail ? `Stock insuficiente: ${tail}` : 'Stock insuficiente.'
}

const invalidInputMessage = (message: string): string => {
  if (/appears twice/.test(message)) return 'Un ingrediente está repetido en la fórmula.'
  if (/cannot use itself|formula cycle/.test(message)) return CYCLE_MESSAGE
  return 'Datos inválidos: revisa los valores ingresados.'
}

const businessRuleMessage = (message: string): string => {
  if (/exceeds the pending quantity/.test(message)) return 'La cantidad recibida supera la cantidad pendiente.'
  if (/has no formula/.test(message)) return 'La preparación no tiene fórmula.'
  if (/insufficient stock/i.test(message)) return 'Stock insuficiente para completar la operación.'
  if (/ is (draft|ordered|partially_received|received|cancelled|open|applied)\b|can only change while|only draft/.test(message)) {
    return 'El documento ya no admite esta operación por su estado actual.'
  }
  return 'La operación no cumple una regla del inventario.'
}

export function toInventoryError(error: unknown): InventoryError {
  if (error instanceof InventoryError) return error
  const e = (error && typeof error === 'object' ? error : {}) as ErrorLike
  const code = typeof e.code === 'string' && e.code ? e.code : 'unknown'
  const message = typeof e.message === 'string' ? e.message : ''

  switch (code) {
    case '22023':
      return new InventoryError(code, invalidInputMessage(message))
    case 'P0002':
      return new InventoryError(code, 'El registro no existe o no pertenece a este restaurante.')
    case '42501':
      return new InventoryError(code, 'No tienes permiso para realizar esta acción.')
    case '23505':
      return new InventoryError(code, 'Ya existe un registro con ese código o nombre.')
    case 'P0001': {
      const shortages = parseShortages(e.details)
      if (shortages) return new InventoryError(code, formatShortages(shortages, message), shortages)
      return new InventoryError(code, businessRuleMessage(message))
    }
    default:
      return new InventoryError(code, 'Ocurrió un error inesperado. Intenta de nuevo.')
  }
}
