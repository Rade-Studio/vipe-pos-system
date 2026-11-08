import { PageHeader } from "@/components/admin/common/PageHeader"
import { DishList } from "@/components/admin/menu/DishList"
import { MenuTreeEditor } from "@/components/admin/menu/MenuTreeEditor"

export function MenuPage({
  description,
  onNavigate,
}: {
  description: string
  onNavigate?: (sectionId: string) => void
}) {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Menú" description={description} />
      <MenuTreeEditor />
      <DishList onNavigate={onNavigate} />
    </div>
  )
}
