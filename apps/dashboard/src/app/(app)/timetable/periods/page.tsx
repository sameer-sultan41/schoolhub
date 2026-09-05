import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WovenRule } from "@/components/woven-rule";
import { PeriodsScreen } from "@/features/timetable/periods-screen";

export const metadata: Metadata = { title: "Periods" };

export default async function TimetablePeriodsPage() {
  const t = await getTranslations("timetable");

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            {t("periods.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("periods.summary")}</p>
        </div>
        <WovenRule className="max-w-24" />
      </div>

      <PeriodsScreen />
    </div>
  );
}
