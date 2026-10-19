import { PageHeader } from "@/components/admin/common/PageHeader"
import { TableManagementPanel } from "@/components/admin/tables/TableManagementPanel"

export function TablesPage({ description }: { description: string }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Mesas" description={description} />
      <TableManagementPanel />
    </div>
  )
}
