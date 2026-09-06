import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ScreenHeader } from "@/components/screen-header";
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
      <ScreenHeader title={t("my.title")} description={t("my.summary")} />

      <MyTimetableScreen />
    </div>
  );
}
