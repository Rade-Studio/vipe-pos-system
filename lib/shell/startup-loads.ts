/**
 * Role-scoped startup loads for the shell (`app/page.tsx`).
 *
 * The shell is the only component every profile mounts, so every request it
 * issues is charged to every profile. Before `cargas-por-perfil` T5 it ran the
 * same chain for everybody: 8 sequential `business_config` reads plus a ninth,
 * all tables, all waiters, kitchen orders and delivered orders as two calls,
 * the open register with its two transaction reads, every register ever with
 * its two unbounded transaction reads, and then a fixed 500 ms full-screen
 * loader on top.
 *
 * Each slice below is listed with the evidence for the role that needs it: a
 * role is only in the list when a view it renders READS that slice, or when
 * the slice is already loaded by the view itself (cited inline). Moving an
 * owner means moving the citation and updating `startup-loads.test.ts`.
 *
 * This module is pure on purpose: no supabase, no store, no React.
 */

/** Canonical order of the shell loads. */
export const SHELL_LOADS = [
  "config",
  "tables",
  "waiters",
  "kitchenOrders",
  "allRegisters",
] as const

export type ShellLoad = (typeof SHELL_LOADS)[number]

/**
 * What an unknown role gets: nothing. An unknown role cannot reach a view
 * (`viewForRole` returns null and the shell renders the fallback), so any
 * request the shell made for it was over-fetch by definition.
 */
export const MINIMAL_SHELL_LOADS: readonly ShellLoad[] = []

const LOADS_BY_ROLE: Record<string, readonly ShellLoad[]> = {
  // config: WaiterView:109 (tip/tax/inventory), DishGrid:39, CartSidebar:73.
  // tables + waiter directory: WaiterView:175-237 hydrates `useTableStore` from
  // its own `['tables']` query and loads its waiters into local state
  // (WaiterView:205-224), so the shell must not repeat either.
  waiter: ["config"],

  // tables: KitchenView:119 reads them and its own `loadInitialData`
  // (KitchenView:488) is never called, so nobody else loads them.
  // waiters: KitchenView:136.
  // config: no kitchen component reads `useConfigStore` (grep over
  // components/views/KitchenView.tsx + components/kitchen/**), and the only
  // consumer of the profile PINs, PasswordDialog, is reachable from
  // "Cambiar Perfil", which Header.tsx:44 renders for `authRole === "admin"`
  // only — and those PINs are no longer synced from the DB (P2).
  kitchen: ["tables", "waiters"],

  // config: CashierView:135, PaymentMethodDialog:140.
  // tables: CashierView:125 (`tableNumberById`).
  // waiters: CashierView:132, TransactionsList:29.
  // No orders: CashierView loads its own (CashierView:74-76) and never reads
  // `useOrderStore`. No registers: the cashier's register consumers
  // (CashRegisterStatus:24, PaymentMethodDialog:139, the open/close dialogs)
  // all hang off CashierView, which already calls `loadCurrentRegister` on
  // mount (CashierView:226), and the register history table is admin-only
  // (AdminView:837).
  cashier: ["config", "tables", "waiters"],

  // config: NewDeliveryDialog:33 and DeliveryOrderForm.
  // No tables, no waiter directory: no delivery component reads
  // `useTableStore` or `useProfileStore.profiles` (DeliveryOrderForm:87 reads
  // `authProfile` only). The board loads the open register itself
  // (DeliveryBoard:89).
  delivery_operator: ["config"],

  // config: CompletedOrdersTable:36, ConfigurationPanel, RecipeManager:80.
  // tables: AdminView:137-156 (dashboard counters read them at mount).
  // waiters: AdminView:164, CompletedOrdersTable:35.
  // kitchenOrders: AdminView:158 / CompletedOrdersTable:34 read the shared
  // `orders` slice. allRegisters: RegisterHistoryTable:21-23 reads it through
  // the store getter and never loads it itself.
  admin: ["config", "tables", "waiters", "kitchenOrders", "allRegisters"],
}

/**
 * The shell loads a role gets at startup. Unknown / missing roles get
 * `MINIMAL_SHELL_LOADS`.
 */
export function startupLoadsForRole(role: string | null | undefined): ShellLoad[] {
  if (!role) return [...MINIMAL_SHELL_LOADS]
  const loads = LOADS_BY_ROLE[role]
  if (!loads) return [...MINIMAL_SHELL_LOADS]
  // Canonical order, de-duplicated, so the caller can rely on a stable shape.
  return SHELL_LOADS.filter((load) => loads.includes(load))
}

/**
 * The role that decides the startup loads: the REAL authenticated role.
 *
 * "Cambiar Perfil" only changes `selectedProfile` (Header.tsx:44 renders it
 * for admins), so an admin impersonating the waiter keeps the admin's loads
 * and no reload happens when the impersonated role changes.
 */
export function startupRole({
  authRole,
  selectedRole,
}: {
  authRole?: string | null
  selectedRole?: string | null
}): string | null {
  return authRole ?? selectedRole ?? null
}