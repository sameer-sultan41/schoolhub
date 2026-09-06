import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ScreenHeader } from "@/components/screen-header";
import { CapacityChart } from "@/features/dashboard/capacity-chart";
import { NowBand } from "@/features/dashboard/now-band";
import { PendingWorkPanel } from "@/features/dashboard/pending-work-panel";
import { QuickActions } from "@/features/dashboard/quick-actions";
import { SchoolShapePanel } from "@/features/dashboard/school-shape-panel";
import { TeacherLoadChart } from "@/features/dashboard/teacher-load-chart";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * The home screen.
 *
 * Async server component doing chrome only: the heading, the sentence and the screen's
 * one woven rule render on the server, and every figure below streams in from a client
 * component, because each needs the user's access token — which by design never leaves
 * the browser's memory.
 *
 * What it shows is decided by what the API can actually answer. The screen this replaced
 * fetched `GET /reports/dashboard-summary`, which does not exist — `apps/api/config/
 * api_v1.py` routes no reporting app — so against a real API it 404'd and the whole tile
 * grid became a red error alert. Three of its four tiles named modules (attendance, fees,
 * admissions) with no backend at all. Every panel here reads an endpoint that ships
 * today, and each one is gated on the key the API enforces for it, so a reader sees the
 * parts of this screen their role can actually answer for.
 *
 * The layout puts the one question a school actually asks at 9am — what is happening
 * right now — across the top, at full width, and everything slower underneath it.
 */
export default async function DashboardPage() {
  const t = await getTranslations("dashboard");

  return (
    <div className="space-y-6">
      <ScreenHeader title={t("title")} description={t("summary")} />

      <NowBand />

      <div className="grid gap-6 lg:grid-cols-2">
        <TeacherLoadChart />
        <PendingWorkPanel />
        <CapacityChart />
        <QuickActions />
      </div>

      <SchoolShapePanel />
    </div>
  );
}
