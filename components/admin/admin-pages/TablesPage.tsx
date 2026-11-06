import { PageHeader } from "@/components/admin/common/PageHeader"
import { FloorPlanEditor } from "@/components/admin/floor/FloorPlanEditor"

export function TablesPage({ description }: { description: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader title="Mesas" description={description} />
      <FloorPlanEditor />
    </div>
  )
}
