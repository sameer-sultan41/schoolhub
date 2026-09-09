import { notFound } from "next/navigation";

import { DashboardPageContent } from "./_metronic/dashboard/dashboard-page-content";

// Whole, real Metronic Demo1 template (header, sidebar, footer, toolbar,
// mega-menu, and Metronic's own 6-widget dashboard body) rendered as-is with
// Metronic's own sample data — a throwaway reference preview, not part of the
// shipped product surface. Dev-only: 404s outside development.
//
// There is currently no auth guard (src/proxy.ts doesn't exist yet) so nothing
// needs bypassing here. When the real auth guard is rebuilt, it will need a
// rule that lets /dev/* routes through in development the same way the
// earlier `d0b54d7` commit's proxy.ts change did.
export default function MetronicDemo1Page() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <DashboardPageContent />;
}
