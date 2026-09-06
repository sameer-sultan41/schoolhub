import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ScreenHeader } from "@/components/screen-header";
import { PromotionBatchReview } from "@/features/academics/promotion-batch-review";

// The batch's own state can't reach metadata: the server has no access token
// (it lives only in the browser's memory), so there is no way to read the batch
// during generateMetadata. A static title is the honest trade-off here, not an
// oversight — mirrors staff/[staffId]/page.tsx exactly.
export const metadata: Metadata = { title: "Promotion batch" };

interface PromotionBatchPageProps {
  params: Promise<{ batchId: string }>;
}

export default async function PromotionBatchPage({ params }: PromotionBatchPageProps) {
  const { batchId } = await params;
  const t = await getTranslations("academics");

  return (
    <div className="space-y-6">
      <ScreenHeader
        title={t("promotions.review.title")}
        description={t("promotions.review.summary")}
      />

      <PromotionBatchReview batchId={batchId} />
    </div>
  );
}
