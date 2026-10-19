"use client"

import { UtensilsCrossed } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { ADMIN_NAV_GROUPS, sectionsInGroup, type AdminSectionId } from "@/lib/admin/navigation"
import { SECTION_ICONS } from "./sections"

interface AdminSidebarProps {
  section: AdminSectionId
  onNavigate: (id: AdminSectionId) => void
  businessName?: string
}

export function AdminSidebar({ section, onNavigate, businessName }: AdminSidebarProps) {
  const { isMobile, setOpenMobile } = useSidebar()

  const go = (id: AdminSectionId) => {
    onNavigate(id)
    if (isMobile) setOpenMobile(false)
  }

  return (
    <Sidebar collapsible="icon" aria-label="Navegación de administración">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-1 py-1.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <UtensilsCrossed className="h-4 w-4" aria-hidden />
          </div>
          <div className="grid min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-semibold">{businessName || "VibePOS"}</span>
            <span className="truncate text-xs text-muted-foreground">Administración</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {ADMIN_NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.id} data-testid={`nav-group-${group.id}`}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {sectionsInGroup(group.id).map((item) => {
                  const Icon = SECTION_ICONS[item.id]
                  const isActive = item.id === section
                  return (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        data-testid={`nav-${item.id}`}
                        isActive={isActive}
                        aria-current={isActive ? "page" : undefined}
                        tooltip={item.label}
                        onClick={() => go(item.id)}
                      >
                        <Icon />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
