import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ScreenHeader } from "@/components/screen-header";
import { StudentsTable } from "@/features/students/students-table";

export const metadata: Metadata = { title: "Students" };

/**
 * Async server component: static chrome renders on the server, and the
 * tenant-scoped roster streams in from the client component below (it needs
 * the user's access token, which by design never leaves the browser's
 * memory) — same split as the dashboard home page.
 */
export default async function StudentsPage() {
  const t = await getTranslations("students");

  return (
    <div className="space-y-6">
      <ScreenHeader title={t("title")} description={t("summary")} />

      <StudentsTable />
    </div>
  );
}
