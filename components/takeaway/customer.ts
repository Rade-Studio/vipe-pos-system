/**
 * The customer of a "Para llevar" order (S8 of promociones-mejoras): the name
 * is required, 2..60 characters after trim (orders_customer_name_check), and
 * the phone optional, normalised with the delivery rule (7..15 digits).
 */
import { normalizePhone } from "@/lib/delivery/phone"

export const TAKEAWAY_NAME_ERROR = "El nombre debe tener entre 2 y 60 caracteres"
export const TAKEAWAY_PHONE_ERROR = "El teléfono debe tener entre 7 y 15 dígitos"

export interface TakeawayCustomer {
  name: string
  /** Digits only; null when not given. */
  phone: string | null
}

export type TakeawayCustomerCheck =
  | { ok: true; customer: TakeawayCustomer }
  | { ok: false; errors: { name?: string; phone?: string } }

export function checkTakeawayCustomer(name: string, phone: string): TakeawayCustomerCheck {
  const trimmed = name.trim()
  const errors: { name?: string; phone?: string } = {}
  if (trimmed.length < 2 || trimmed.length > 60) errors.name = TAKEAWAY_NAME_ERROR
  const digits = phone.trim() === "" ? null : normalizePhone(phone)
  if (phone.trim() !== "" && digits === null) errors.phone = TAKEAWAY_PHONE_ERROR
  if (errors.name || errors.phone) return { ok: false, errors }
  return { ok: true, customer: { name: trimmed, phone: digits } }
}
