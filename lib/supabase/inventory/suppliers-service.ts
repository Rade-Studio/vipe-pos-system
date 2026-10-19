/** Suppliers. Soft-deleted through `is_active`; no DELETE policy. */

import { db, unwrap } from "./shared"
import type { Supplier, SupplierInput } from "./types"

const COLUMNS = "id, name, tax_id, contact_name, phone, email, lead_time_days, notes, is_active"

interface SupplierRow {
  id: string
  name: string
  tax_id: string | null
  contact_name: string | null
  phone: string | null
  email: string | null
  lead_time_days: number | null
  notes: string | null
  is_active: boolean
}

const mapSupplier = (r: SupplierRow): Supplier => ({
  id: r.id,
  name: r.name,
  taxId: r.tax_id,
  contactName: r.contact_name,
  phone: r.phone,
  email: r.email,
  leadTimeDays: r.lead_time_days,
  notes: r.notes,
  isActive: r.is_active,
})

const toPatch = (input: Partial<SupplierInput>): Record<string, unknown> => {
  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = input.name.trim()
  if (input.taxId !== undefined) patch.tax_id = input.taxId
  if (input.contactName !== undefined) patch.contact_name = input.contactName
  if (input.phone !== undefined) patch.phone = input.phone
  if (input.email !== undefined) patch.email = input.email
  if (input.leadTimeDays !== undefined) patch.lead_time_days = input.leadTimeDays
  if (input.notes !== undefined) patch.notes = input.notes
  if (input.isActive !== undefined) patch.is_active = input.isActive
  return patch
}

export async function listSuppliers(): Promise<Supplier[]> {
  const rows = await unwrap<SupplierRow[] | null>(db.from("suppliers").select(COLUMNS).order("name", { ascending: true }))
  return (rows ?? []).map(mapSupplier)
}

export async function createSupplier(input: SupplierInput): Promise<Supplier> {
  return mapSupplier(await unwrap<SupplierRow>(db.from("suppliers").insert(toPatch(input)).select(COLUMNS).single()))
}

export async function updateSupplier(id: string, input: Partial<SupplierInput>): Promise<Supplier> {
  return mapSupplier(await unwrap<SupplierRow>(db.from("suppliers").update(toPatch(input)).eq("id", id).select(COLUMNS).single()))
}
