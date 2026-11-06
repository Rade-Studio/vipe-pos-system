"use client"

import { useEffect, useState, type CSSProperties, type ReactNode } from "react"
import type { Profile } from "@/types"
import { roleLabel } from "@/lib/auth/roles"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import type { AdminSectionId } from "@/lib/admin/navigation"
import { useConfigStore } from "@/store/use-config-store"
import { AdminSidebar } from "./AdminSidebar"
import { AdminTopbar } from "./AdminTopbar"
import { CommandMenu } from "./CommandMenu"

interface AdminShellProps {
  profile: Profile
  authRole?: string
  onChangeProfile: () => void
  section: AdminSectionId
  onNavigate: (id: AdminSectionId) => void
  children: ReactNode
}

/**
 * Sidebar + top bar + ⌘K around the open admin page, all on one canvas.
 *
 * Tablets (768-1279 px) start with the sidebar collapsed to a 72 px icon rail: expanded it
 * takes a third of the screen and squeezes every table. Phones get the sheet
 * and wide screens the full sidebar. The admin view only mounts on the client
 * (after sign-in), so reading the window here is safe.
 */
const SIDEBAR_EXPANDED_FROM = 1280

function sidebarStartsOpen(): boolean {
  return typeof window === "undefined" || window.innerWidth >= SIDEBAR_EXPANDED_FROM
}

export function AdminShell({ profile, authRole, onChangeProfile, section, onNavigate, children }: AdminShellProps) {
  const [commandOpen, setCommandOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(sidebarStartsOpen)

  // Crossing 1280 px switches between the full sidebar and the icon rail; a
  // manual toggle on a wide screen holds until the next crossing.
  useEffect(() => {
    let wide = sidebarStartsOpen()
    const onResize = () => {
      const nowWide = sidebarStartsOpen()
      if (nowWide !== wide) setSidebarOpen(nowWide)
      wide = nowWide
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])
  const businessName = useConfigStore((s) => s.businessName)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setCommandOpen((open) => !open)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
      style={{ "--sidebar-width": "16rem", "--sidebar-width-icon": "4.5rem" } as CSSProperties}
    >
      <AdminSidebar
        section={section}
        onNavigate={onNavigate}
        businessName={businessName}
        roleName={roleLabel(profile.role) ?? profile.role}
      />
      <SidebarInset className="min-w-0 bg-canvas">
        <AdminTopbar
          profile={profile}
          authRole={authRole}
          section={section}
          onChangeProfile={onChangeProfile}
          onOpenCommand={() => setCommandOpen(true)}
        />
        <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-5 px-4 pb-10 pt-5 md:gap-6 md:p-6">{children}</div>
      </SidebarInset>
      <CommandMenu
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onNavigate={onNavigate}
        onChangeProfile={authRole === "admin" ? onChangeProfile : undefined}
      />
    </SidebarProvider>
  )
}
