"use client"

import { createContext, useContext } from "react"

/** The staff member identified on a shared terminal (F4b), until `deadline` (ms). */
export interface TerminalIdentity {
  id: string
  name: string
  role: string
  deadline: number
}

/** What an order-writing entry asks for: the table it opens or writes, and its label ("Mesa 7"). */
export interface IdentityRequest {
  tableId?: string
  label: string
}

export interface TerminalApi {
  identity: TerminalIdentity | null
  /** The clock the header countdown uses (ms). */
  now: number
  /**
   * Resolves true once someone with a valid PIN is identified (at once when
   * the identity is still valid) and, for a table with unsent products of
   * another person, once Continuar or Descartar was chosen; false when the
   * sheet was closed.
   */
  ensureIdentity: (request: IdentityRequest) => Promise<boolean>
  /** "Terminar": ends the identity now; the cart stays. */
  endIdentity: () => void
  /** "Salir": an admin or cashier picks themselves and types their PIN before the logout. */
  requestLogout: () => void
}

export const TerminalContext = createContext<TerminalApi | null>(null)

/** The shared terminal around this screen, or null on a personal session. */
export function useTerminal(): TerminalApi | null {
  return useContext(TerminalContext)
}
