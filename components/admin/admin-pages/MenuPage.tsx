import { PageHeader } from "@/components/admin/common/PageHeader"
import { CategoryList } from "@/components/admin/menu/CategoryList"
import { DishList } from "@/components/admin/menu/DishList"
import { PromotionList } from "@/components/admin/promotions/PromotionList"

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
      <CategoryList />
      <DishList onNavigate={onNavigate} />
      <PromotionList />
    </div>
  )
}
