"use client"

import { LogOut, Moon, UserCog } from "lucide-react"
import { useTheme } from "next-themes"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { ADMIN_NAV_GROUPS, sectionsInGroup, type AdminSectionId } from "@/lib/admin/navigation"
import { SECTION_ICONS } from "./sections"
import { signOutAndLeave } from "./actions"

interface CommandMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNavigate: (id: AdminSectionId) => void
  /** Present only for the real admin; hides "Cambiar perfil" otherwise. */
  onChangeProfile?: () => void
}

export function CommandMenu({ open, onOpenChange, onNavigate, onChangeProfile }: CommandMenuProps) {
  const { theme, setTheme } = useTheme()

  const run = (action: () => void) => {
    onOpenChange(false)
    action()
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Ir a una sección o acción…" />
      <CommandList>
        <CommandEmpty>Sin resultados.</CommandEmpty>
        {ADMIN_NAV_GROUPS.map((group) => (
          <CommandGroup key={group.id} heading={group.label}>
            {sectionsInGroup(group.id).map((section) => {
              const Icon = SECTION_ICONS[section.id]
              return (
                <CommandItem
                  key={section.id}
                  value={`${group.label} ${section.label}`}
                  onSelect={() => run(() => onNavigate(section.id))}
                >
                  <Icon className="mr-2 h-4 w-4" />
                  <span>{section.label}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{group.label}</span>
                </CommandItem>
              )
            })}
          </CommandGroup>
        ))}
        <CommandSeparator />
        <CommandGroup heading="Acciones">
          <CommandItem value="Cambiar tema" onSelect={() => run(() => setTheme(theme === "dark" ? "light" : "dark"))}>
            <Moon className="mr-2 h-4 w-4" />
            Cambiar tema
          </CommandItem>
          {onChangeProfile && (
            <CommandItem value="Cambiar perfil" onSelect={() => run(onChangeProfile)}>
              <UserCog className="mr-2 h-4 w-4" />
              Cambiar perfil
            </CommandItem>
          )}
          <CommandItem value="Cerrar sesión" onSelect={() => run(() => void signOutAndLeave())}>
            <LogOut className="mr-2 h-4 w-4" />
            Cerrar sesión
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
