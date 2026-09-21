import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { ClientProviders } from "@/components/ClientProviders"

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
