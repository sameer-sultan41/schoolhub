import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ScreenHeader } from "@/components/screen-header";
import { PeriodsScreen } from "@/features/timetable/periods-screen";

export const metadata: Metadata = { title: "Periods" };

export default async function TimetablePeriodsPage() {
  const t = await getTranslations("timetable");

  return (
    <div className="space-y-6">
      <ScreenHeader title={t("periods.title")} description={t("periods.summary")} />

      <PeriodsScreen />
    </div>
  );
}
