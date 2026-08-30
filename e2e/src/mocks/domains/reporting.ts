import type { DashboardStats } from "@/data/factories";
import { buildDashboardStats } from "@/data/factories";
import { ok } from "../envelope";
import type { MockModule } from "../router";

/**
 * `/reports/*` — currently just the dashboard's summary tiles.
 *
 * `DashboardSummary` (apps/dashboard/src/features/dashboard/dashboard-summary.tsx) fetches
 * this on every `/dashboard` render, so any spec that lands there needs it stubbed — see
 * `signedIn` in `src/fixtures/index.ts`, which includes it by default.
 *
 * There is no backend route for this endpoint yet (nothing under apps/api matches
 * `reports/dashboard-summary`) — the frontend was built ahead of it. This stub models the
 * contract the frontend already assumes, not a route that exists today.
 */
export function reportingModule(stats: DashboardStats = buildDashboardStats()): MockModule {
  return (api) => {
    api.get("/reports/dashboard-summary", () => ok(stats));
  };
}
