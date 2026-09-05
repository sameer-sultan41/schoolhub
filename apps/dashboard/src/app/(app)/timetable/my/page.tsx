import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WovenRule } from "@/components/woven-rule";
import { MyTimetableScreen } from "@/features/timetable/my-timetable-screen";

export const metadata: Metadata = { title: "My timetable" };

/**
 * The one timetable screen students, guardians and teachers all reach — every
 * role holds `timetable.timetable.view`, record-scoped server-side.
 */
export default async function MyTimetablePage() {
  const t = await getTranslations("timetable");

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold text-foreground">{t("my.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("my.summary")}</p>
        </div>
        <WovenRule className="max-w-24" />
      </div>

      <MyTimetableScreen />
    </div>
  );
}
