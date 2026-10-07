"use client"

import type React from "react"
import { QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "@/components/theme/theme-provider"
import { Toaster } from "@/components/ui/toaster"
// ONE client for the whole app, created in client code only: this module is
// "use client", and the `QueryClient` class instance must never cross the
// Server -> Client boundary (that was the reason this provider existed instead
// of building one on the server).
//
// It used to build a SECOND instance here, while CashRegisterStatus,
// PaymentMethodDialog, KitchenView, WaiterView, CashierView and AdminView import
// this one to `setQueryData` / `invalidateQueries`. Every `useQuery` read the
// provider's cache, so those six screens wrote into a cache nobody read.
import { queryClient } from "@/lib/queryClient"

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        {children}
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  )
}