import type { ReactNode } from "react"
import { PageHeader } from "@/components/admin/common/PageHeader"

interface SettingsPageProps {
  title: string
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
}

/** Common frame of the Configuración pages: a narrow, readable column. */
export function SettingsPage({ title, description, actions, children }: SettingsPageProps) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <PageHeader title={title} description={description} actions={actions} />
      {children}
    </div>
  )
}
