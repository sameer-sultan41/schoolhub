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
 * right now — across the top, at full width. The figures follow immediately, then the
 * slower panels.
 *
 * The bands below are asymmetric on purpose. A horizontal bar chart needs the width more
 * than a five-item queue or a column of action links does, and the even 2x2 this replaced
 * gave both the same, so the charts were cramped while the panels ran short.
 */
export default async function DashboardPage() {
  const t = await getTranslations("dashboard");

  return (
    <div className="space-y-6">
      <ScreenHeader title={t("title")} description={t("summary")} />

      <NowBand />

      {/* Promoted from the foot of the screen: a reader who wants the shape of the school
          should not have to scroll past two charts to reach it. */}
      <SchoolShapePanel />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TeacherLoadChart />
        </div>
        <PendingWorkPanel />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CapacityChart />
        </div>
        <QuickActions />
      </div>
    </div>
  );
}
