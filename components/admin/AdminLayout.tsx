import { Header } from "@/components/layout/Header"
import type { Profile } from "@/types"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  Table,
  ClipboardList,
  CreditCard,
  Settings,
} from "lucide-react"
import React from "react"

interface AdminLayoutProps {
  children: React.ReactNode
  profile: Profile
  onChangeProfile: () => void
  activeTab: string
  onSelectTab: (tab: string) => void
}

const navItems = [
  { label: "Dashboard", value: "dashboard", icon: LayoutDashboard },
  { label: "Mesas", value: "tables", icon: Table },
  { label: "Órdenes", value: "orders", icon: ClipboardList },
  { label: "Caja", value: "cash", icon: CreditCard },
  { label: "Configuración", value: "config", icon: Settings },
]

export function AdminLayout({
  children,
  profile,
  onChangeProfile,
  activeTab,
  onSelectTab,
}: AdminLayoutProps) {
  return (
    <div className="flex h-screen">
      <aside className="hidden md:flex w-56 flex-col border-r bg-muted/20">
        <div className="p-4 text-lg font-semibold">Admin</div>
        <nav className="flex-1 px-2 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.value}
              onClick={() => onSelectTab(item.value)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted",
                activeTab === item.value && "bg-muted"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <div className="flex flex-col flex-1 overflow-hidden">
        <Header
          profile={profile}
          onChangeProfile={onChangeProfile}
          title="Panel de Administración"
        />
        <main className="flex-1 overflow-y-auto p-4">{children}</main>
      </div>
    </div>
  )
}
