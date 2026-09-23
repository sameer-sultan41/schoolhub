import { DashboardPageContent } from "@/app/(app)/shell/dashboard/dashboard-page-content";

// No auth guard yet (apps/dashboard/src/proxy.ts doesn't exist) — this route
// is reachable unauthenticated until that's rebuilt (apps/dashboard/AGENTS.md).
export default function DashboardPage() {
  return <DashboardPageContent />;
}
