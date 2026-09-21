import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { ClientProviders } from "@/components/ClientProviders"

// The app is fully auth-aware and every page boots from the user's
// authenticated session (loadProfileFromAuth, getSession, etc.). Forcing
// dynamic rendering here keeps Next.js from trying to prerender routes at
// build time, which would fail with "supabaseKey is required" when the
// build environment is missing a valid NEXT_PUBLIC_SUPABASE_ANON_KEY
// (e.g. when DEV_SUPABASE_ANON_KEY secret is not configured in CI).
export const dynamic = "force-dynamic"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Vipe POS",
  description: "Sistema de punto de venta para restaurantes",
  icons: {
    icon: [
      {url: "/favicon.ico", sizes: "any"},
      {url: "/vipe-pos.png", type: "image/png"},
      {url: "/icon-192.png", type: "image/png", sizes: "192x192"},
      {url: "/icon-512.png", type: "image/png", sizes: "512x512"},
    ],
    apple: {url: "/apple-icon.png", type: "image/png"},
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={inter.className}>
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  )
}
