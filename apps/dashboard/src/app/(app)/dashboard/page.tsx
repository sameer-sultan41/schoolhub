import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * Bare placeholder — the home screen's real content (bell-schedule band, charts, panels)
 * was deleted along with every other business route and is rebuilt in a later chunk. This
 * exists only so the app shell has somewhere to render. See docs/metronic-dashboard-shell.md.
 */
export default async function DashboardPage() {
  const t = await getTranslations("dashboard");

  return (
    <div>
      <h1 className="font-heading text-2xl font-semibold text-foreground">{t("title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("summary")}</p>
    </div>
  );
}
