"use client"

import { useEffect, useState, type CSSProperties, type ReactNode } from "react"
import type { Profile } from "@/types"
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

/** Sidebar + top bar + ⌘K around the open admin page. */
export function AdminShell({ profile, authRole, onChangeProfile, section, onNavigate, children }: AdminShellProps) {
  const [commandOpen, setCommandOpen] = useState(false)
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
    <SidebarProvider style={{ "--sidebar-width": "16rem", "--sidebar-width-icon": "3rem" } as CSSProperties}>
      <AdminSidebar section={section} onNavigate={onNavigate} businessName={businessName} />
      <SidebarInset className="min-w-0">
        <AdminTopbar
          profile={profile}
          authRole={authRole}
          section={section}
          onChangeProfile={onChangeProfile}
          onOpenCommand={() => setCommandOpen(true)}
        />
        <div className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-6 p-4 md:p-6">{children}</div>
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
