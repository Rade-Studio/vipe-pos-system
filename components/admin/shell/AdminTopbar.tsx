"use client"

import { LogOut, Menu, PanelLeft, Search, UserCog } from "lucide-react"
import type { Profile } from "@/types"
import { ThemeToggle } from "@/components/theme/theme-toggle"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useSidebar } from "@/components/ui/sidebar"
import { roleLabel } from "@/lib/auth/roles"
import { getAdminSection, groupOfSection, type AdminSectionId } from "@/lib/admin/navigation"
import { signOutAndLeave } from "./actions"

interface AdminTopbarProps {
  profile: Profile
  authRole?: string
  section: AdminSectionId
  onChangeProfile: () => void
  onOpenCommand: () => void
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  )
}

export function AdminTopbar({ profile, authRole, section, onChangeProfile, onOpenCommand }: AdminTopbarProps) {
  const current = getAdminSection(section)
  const group = groupOfSection(section)
  const role = roleLabel(profile.role) ?? profile.role

  const { setOpenMobile, toggleSidebar, state } = useSidebar()

  return (
    <header className="sticky top-0 z-30 flex min-h-[60px] shrink-0 items-center gap-2 border-b border-line bg-[color-mix(in_srgb,var(--canvas)_80%,transparent)] px-3 py-2 backdrop-blur-xl md:gap-3 md:px-6">
      {/* Phones: the navigation is a drawer. Tablets keep the icon rail, wide screens may collapse it. */}
      <Button
        variant="ghost"
        size="icon"
        className="size-11 shrink-0 rounded-full md:hidden"
        aria-label="Abrir menú"
        onClick={() => setOpenMobile(true)}
      >
        <Menu className="h-5 w-5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="hidden size-11 shrink-0 rounded-full xl:inline-flex"
        aria-label={state === "expanded" ? "Contraer menú" : "Expandir menú"}
        onClick={toggleSidebar}
      >
        <PanelLeft className="h-5 w-5" />
      </Button>
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap text-muted-fg">
          <BreadcrumbItem className="hidden md:inline-flex">{group.label}</BreadcrumbItem>
          <BreadcrumbSeparator className="hidden md:block" />
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage className="truncate font-semibold text-fg">{current.label}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <Button
        variant="outline"
        onClick={onOpenCommand}
        className="size-11 shrink-0 gap-2 rounded-full border-line-strong bg-surface-2 p-0 text-muted-fg hover:bg-surface hover:text-fg lg:w-64 lg:justify-start lg:px-3.5"
        aria-label="Buscar sección o acción"
      >
        <Search className="h-4 w-4" />
        <span className="hidden min-w-0 truncate lg:inline">Buscar…</span>
        <kbd className="pointer-events-none ml-auto hidden h-5 select-none items-center gap-1 rounded-md border border-line-strong px-1.5 font-mono text-[11px] font-medium text-fg-2 lg:inline-flex">
          ⌘K
        </kbd>
      </Button>

      <div className="shrink-0 [&>button]:size-11 [&>button]:rounded-full">
        <ThemeToggle />
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-11 shrink-0 gap-2.5 rounded-full px-1.5 xl:pr-3" aria-label="Menú de perfil">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="border border-brand-line bg-brand-tint text-xs font-semibold text-brand-strong">
                {initials(profile.name)}
              </AvatarFallback>
            </Avatar>
            <span className="hidden flex-col items-start leading-tight xl:flex">
              <span className="text-sm font-medium">{profile.name}</span>
              <span className="text-xs text-muted-fg">{role}</span>
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col">
              <span className="text-sm font-medium">{profile.name}</span>
              <span className="text-xs text-muted-foreground">{role}</span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {/* Only the REAL admin (not an impersonated view) may switch profiles. */}
          {authRole === "admin" && (
            <DropdownMenuItem onSelect={onChangeProfile}>
              <UserCog className="mr-2 h-4 w-4" />
              Cambiar perfil
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => void signOutAndLeave()}>
            <LogOut className="mr-2 h-4 w-4" />
            Cerrar sesión
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
