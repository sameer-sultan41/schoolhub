import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ScreenHeader } from "@/components/screen-header";
import { PromotionBatchesScreen } from "@/features/academics/promotion-batches-screen";

export const metadata: Metadata = { title: "Promotions" };

export default async function AcademicsPromotionsPage() {
  const t = await getTranslations("academics");

  return (
    <div className="space-y-6">
      <ScreenHeader title={t("promotions.title")} description={t("promotions.summary")} />

      <PromotionBatchesScreen />
    </div>
  );
}
