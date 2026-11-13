import type { Table } from "@/types"

/**
 * Carta inbox items on the floor (ux-carta-mesero S4): each pending guest
 * proposal, bill request or waiter call lands on its table. The inbox has no
 * table id, so a table is found by zone name + number.
 */
export type TableAlertKind = "proposal" | "bill" | "waiter"

export interface TableAlert {
  kinds: ReadonlySet<TableAlertKind>
  /** Pending items on the table. */
  count: number
}

interface InboxRow {
  tableNumber: number
  zoneName: string | null
}

export interface InboxLike {
  proposals: readonly InboxRow[]
  requests: readonly (InboxRow & { kind: string })[]
}

/** Most urgent first: the icon shows the first kind present, the name lists them in this order. */
const PRIORITY: readonly TableAlertKind[] = ["bill", "waiter", "proposal"]

const TEXT: Record<TableAlertKind, string> = {
  bill: "pide la cuenta",
  waiter: "llama al mesero",
  proposal: "pedido de la carta por confirmar",
}

const norm = (name: string | null | undefined) => (name ?? "").trim().toLocaleLowerCase("es")

/**
 * Table id → alert. With a zone name the table must be in that zone; without
 * one only a table number that is unique on the floor matches. Either way an
 * ambiguous match (two zones sharing a name) badges no table.
 */
export function matchTableAlerts(
  inbox: InboxLike | undefined,
  tables: readonly Table[],
  zoneNameOf: (zoneId: string | undefined) => string | undefined,
): Map<string, TableAlert> {
  const alerts = new Map<string, { kinds: Set<TableAlertKind>; count: number }>()
  if (!inbox) return alerts
  const find = (row: InboxRow): Table | undefined => {
    const sameNumber = tables.filter((table) => table.number === row.tableNumber)
    const candidates = row.zoneName
      ? sameNumber.filter((table) => norm(zoneNameOf(table.zoneId)) === norm(row.zoneName))
      : sameNumber
    return candidates.length === 1 ? candidates[0] : undefined
  }
  const add = (row: InboxRow, kind: TableAlertKind) => {
    const table = find(row)
    if (!table) return
    const alert = alerts.get(table.id) ?? { kinds: new Set<TableAlertKind>(), count: 0 }
    alert.kinds.add(kind)
    alert.count += 1
    alerts.set(table.id, alert)
  }
  inbox.proposals.forEach((row) => add(row, "proposal"))
  inbox.requests.forEach((row) => add(row, row.kind === "bill" ? "bill" : "waiter"))
  return alerts
}

export const alertIconKind = (alert: TableAlert): TableAlertKind =>
  PRIORITY.find((kind) => alert.kinds.has(kind)) ?? "proposal"

/** "pide la cuenta, pedido de la carta por confirmar": appended to the table's accessible name. */
export const alertText = (alert: TableAlert): string =>
  PRIORITY.filter((kind) => alert.kinds.has(kind))
    .map((kind) => TEXT[kind])
    .join(", ")
