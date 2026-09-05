import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WovenRule } from "@/components/woven-rule";
import { RoomsScreen } from "@/features/timetable/rooms-screen";

export const metadata: Metadata = { title: "Rooms" };

export default async function TimetableRoomsPage() {
  const t = await getTranslations("timetable");

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            {t("rooms.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("rooms.summary")}</p>
        </div>
        <WovenRule className="max-w-24" />
      </div>

      <RoomsScreen />
    </div>
  );
}
