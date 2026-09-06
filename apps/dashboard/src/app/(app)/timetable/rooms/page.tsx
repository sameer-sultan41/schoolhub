import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ScreenHeader } from "@/components/screen-header";
import { RoomsScreen } from "@/features/timetable/rooms-screen";

export const metadata: Metadata = { title: "Rooms" };

export default async function TimetableRoomsPage() {
  const t = await getTranslations("timetable");

  return (
    <div className="space-y-6">
      <ScreenHeader title={t("rooms.title")} description={t("rooms.summary")} />

      <RoomsScreen />
    </div>
  );
}
