import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WovenRule } from "@/components/woven-rule";
import { PromotionBatchesScreen } from "@/features/academics/promotion-batches-screen";

export const metadata: Metadata = { title: "Promotions" };

export default async function AcademicsPromotionsPage() {
  const t = await getTranslations("academics");

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            {t("promotions.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("promotions.summary")}</p>
        </div>
        <WovenRule className="max-w-24" />
      </div>

      <PromotionBatchesScreen />
    </div>
  );
}
