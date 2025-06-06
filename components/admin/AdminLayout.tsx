import { Header } from "@/components/layout/Header"
import type { Profile } from "@/types"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  Table,
  ClipboardList,
  CreditCard,
  Settings,
  Utensils,
  Boxes,
  Users,
  Store,
} from "lucide-react"
import React from "react"

interface AdminLayoutProps {
  children: React.ReactNode
  profile: Profile
  onChangeProfile: () => void
  activeTab: string
  onSelectTab: (tab: string) => void
}

interface NavItem {
  label: string
  value: string
  icon: React.ComponentType<{ className?: string }>
  children?: NavItem[]
}

const navItems: NavItem[] = [
  { label: "Dashboard", value: "dashboard", icon: LayoutDashboard },
  { label: "Mesas", value: "tables", icon: Table },
  { label: "Órdenes", value: "orders", icon: ClipboardList },
  { label: "Caja", value: "cash", icon: CreditCard },
  {
    label: "Configuración",
    value: "config",
    icon: Settings,
    children: [
      { label: "Menú", value: "config_menu", icon: Utensils },
      { label: "Inventario y Stock", value: "config_inventory", icon: Boxes },
      { label: "Personal", value: "config_personal", icon: Users },
      { label: "Negocio", value: "config_business", icon: Store },
    ],
  },
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
            <div key={item.value} className="space-y-1">
              <button
                onClick={() => item.children ? null : onSelectTab(item.value)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted",
                  activeTab === item.value && "bg-muted",
                  item.children && "cursor-default"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </button>
              {item.children && (
                <div className="ml-4 space-y-1">
                  {item.children.map((child) => (
                    <button
                      key={child.value}
                      onClick={() => onSelectTab(child.value)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted",
                        activeTab === child.value && "bg-muted"
                      )}
                    >
                      <child.icon className="h-4 w-4" />
                      {child.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
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
