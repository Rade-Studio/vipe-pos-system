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
  roleName?: string
}

/**
 * Pill items on the page canvas: the active one is a violet tint with a violet
 * line, focus is the separate sky ring. On the icon rail every item is a 44 px
 * target and its label shows as a tooltip on hover and focus.
 */
const NAV_ITEM_CLASS = [
  "h-10 gap-3 rounded-full px-3 text-fg-2 transition-colors motion-reduce:transition-none",
  "hover:bg-surface-2 hover:text-fg active:bg-surface-2 active:text-fg",
  "focus-visible:ring-2 focus-visible:ring-focus",
  "data-[active=true]:bg-brand-tint data-[active=true]:text-brand-strong data-[active=true]:shadow-[inset_0_0_0_1px_var(--accent-line)]",
  "data-[active=true]:hover:bg-brand-tint data-[active=true]:hover:text-brand-strong",
  "group-data-[collapsible=icon]:!size-11 group-data-[collapsible=icon]:!p-0 group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:[&>span]:hidden",
].join(" ")

export function AdminSidebar({ section, onNavigate, businessName, roleName = "Administración" }: AdminSidebarProps) {
  const { isMobile, setOpenMobile } = useSidebar()

  const go = (id: AdminSectionId) => {
    onNavigate(id)
    if (isMobile) setOpenMobile(false)
  }

  return (
    <Sidebar collapsible="icon" aria-label="Navegación de administración" className="border-line">
      <SidebarHeader className="px-3 pt-3.5">
        <div
          data-testid="admin-brand"
          className="flex min-w-0 items-center gap-3 border-b border-line px-1.5 pb-3.5 pt-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#7c3aed] text-white shadow-glow">
            <UtensilsCrossed className="h-[18px] w-[18px]" aria-hidden />
          </div>
          <div className="grid min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate font-semibold text-fg">VipePOS</span>
            <span className="truncate text-xs text-muted-fg">
              {businessName ? `${businessName} · ${roleName}` : roleName}
            </span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0 px-1 pb-3 [scrollbar-width:thin] group-data-[collapsible=icon]:overflow-y-auto group-data-[collapsible=icon]:overflow-x-hidden">
        {ADMIN_NAV_GROUPS.map((group) => (
          <SidebarGroup
            key={group.id}
            data-testid={`nav-group-${group.id}`}
            className="group-data-[collapsible=icon]:mt-2 group-data-[collapsible=icon]:border-t group-data-[collapsible=icon]:border-line group-data-[collapsible=icon]:pt-2 group-data-[collapsible=icon]:first:mt-0 group-data-[collapsible=icon]:first:border-t-0"
          >
            <SidebarGroupLabel className="px-3 group-data-[collapsible=icon]:hidden text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-fg">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
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
                        className={NAV_ITEM_CLASS}
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
