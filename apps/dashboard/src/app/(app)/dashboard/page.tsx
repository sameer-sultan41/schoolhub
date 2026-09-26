import { DashboardPageContent } from "@/app/(app)/shell/dashboard/dashboard-page-content";

// Routing-only auth guard: src/proxy.ts sends a visitor with no session cookie to /login.
// Real access control is the API's (apps/dashboard/AGENTS.md).
export default function DashboardPage() {
  return <DashboardPageContent />;
}
