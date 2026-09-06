import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ScreenHeader } from "@/components/screen-header";
import { StaffTable } from "@/features/staff/staff-table";

export const metadata: Metadata = { title: "Staff" };

/**
 * Async server component: static chrome renders on the server, and the
 * tenant-scoped roster streams in from the client component below (it needs
 * the user's access token, which by design never leaves the browser's
 * memory) — same split as students/page.tsx.
 */
export default async function StaffPage() {
  const t = await getTranslations("staff");

  return (
    <div className="space-y-6">
      <ScreenHeader title={t("title")} description={t("summary")} />

      <StaffTable />
    </div>
  );
}
