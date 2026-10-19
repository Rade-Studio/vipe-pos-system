import { PageHeader } from "@/components/admin/common/PageHeader"
import { CategoryList } from "@/components/admin/menu/CategoryList"
import { DishList } from "@/components/admin/menu/DishList"
import { PromotionList } from "@/components/admin/promotions/PromotionList"

export function MenuPage({ description }: { description: string }) {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Menú" description={description} />
      <CategoryList />
      <DishList />
      <PromotionList />
    </div>
  )
}
