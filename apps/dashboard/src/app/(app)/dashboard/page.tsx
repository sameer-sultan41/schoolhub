import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WovenRule } from "@/components/woven-rule";
import { DashboardSummary } from "@/features/dashboard/dashboard-summary";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * Async server component: static chrome renders on the server, and the tenant-scoped
 * numbers stream in from the client component below (they need the user's access token,
 * which by design never leaves the browser's memory).
 */
export default async function DashboardPage() {
  const t = await getTranslations("dashboard");

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold text-foreground">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("summary")}</p>
        </div>
        <WovenRule className="max-w-24" />
      </div>

      <DashboardSummary />
    </div>
  );
}
