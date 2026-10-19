"use client"

import { LogOut, Search, UserCog } from "lucide-react"
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
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
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

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 h-4" />
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap">
          <BreadcrumbItem className="hidden sm:inline-flex">{group.label}</BreadcrumbItem>
          <BreadcrumbSeparator className="hidden sm:block" />
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage className="truncate">{current.label}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <Button
        variant="outline"
        size="sm"
        onClick={onOpenCommand}
        className="h-8 gap-2 px-2 text-muted-foreground md:w-56 md:justify-start md:px-3"
        aria-label="Buscar sección o acción"
      >
        <Search className="h-4 w-4" />
        <span className="hidden md:inline">Buscar…</span>
        <kbd className="pointer-events-none ml-auto hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium md:inline-flex">
          ⌘K
        </kbd>
      </Button>

      <ThemeToggle />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-9 gap-2 px-1.5" aria-label="Menú de perfil">
            <Avatar className="h-7 w-7">
              <AvatarFallback className="text-xs">{initials(profile.name)}</AvatarFallback>
            </Avatar>
            <span className="hidden flex-col items-start leading-tight lg:flex">
              <span className="text-sm font-medium">{profile.name}</span>
              <span className="text-xs text-muted-foreground">{role}</span>
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
