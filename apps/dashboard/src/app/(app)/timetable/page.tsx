import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ScreenHeader } from "@/components/screen-header";
import { WeekGridScreen } from "@/features/timetable/week-grid-screen";

export const metadata: Metadata = { title: "Timetable" };

/**
 * Async server component: static chrome renders on the server, and the
 * tenant-scoped week grid streams in from the client component below (it needs
 * the user's access token, which by design never leaves the browser's memory) —
 * same split as academics/page.tsx and staff/page.tsx.
 */
export default async function TimetablePage() {
  const t = await getTranslations("timetable");

  return (
    <div className="space-y-6">
      <ScreenHeader title={t("grid.title")} description={t("grid.summary")} />

      <WeekGridScreen />
    </div>
  );
}
