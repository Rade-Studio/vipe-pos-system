import { PageHeader } from "@/components/admin/common/PageHeader"
import { PromotionList } from "@/components/admin/promotions/PromotionList"

export function PromotionsPage({ description }: { description: string }) {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Promociones" description={description} />
      <PromotionList />
    </div>
  )
}
