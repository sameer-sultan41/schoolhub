import { Container } from "@/app/(app)/shell/partials/common/container";
import { StaffDirectoryTable } from "@/app/(app)/staff/staff-directory-table";
import { StaffToolbar } from "@/app/(app)/staff/staff-toolbar";

// No page-level authorization check of its own — same as every route in this app,
// /dashboard included. Session presence is enforced app-wide by the routing-only guard
// in apps/dashboard/src/proxy.ts (see apps/dashboard/AGENTS.md's routing table), not
// per-page. (/dashboard/page.tsx's own comment claims proxy.ts "doesn't exist yet" —
// it already does, and already covers this route too; that comment predates proxy.ts
// and is stale, but fixing it is outside this task's three files.)
//
// This stays a plain server component: `StaffToolbar` is the one part of this route
// that needs client-side data (the two live stats), so only it is `"use client"` — the
// same thin-route/client-content split `dashboard/page.tsx` already uses for
// `DashboardPageContent`. The page title ("Staff") is not passed explicitly; it
// resolves automatically from `menu-config.ts`'s "Staff" entry, same as every other
// route's `ToolbarHeading` in this app.
export default function StaffPage() {
  return (
    <>
      <Container>
        <StaffToolbar />
      </Container>
      <Container>
        <StaffDirectoryTable />
      </Container>
    </>
  );
}
