import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ScreenHeader } from "@/components/screen-header";
import { SubstitutionsScreen } from "@/features/timetable/substitutions-screen";

export const metadata: Metadata = { title: "Substitutions" };

export default async function TimetableSubstitutionsPage() {
  const t = await getTranslations("timetable");

  return (
    <div className="space-y-6">
      <ScreenHeader title={t("substitutions.title")} description={t("substitutions.summary")} />

      <SubstitutionsScreen />
    </div>
  );
}
