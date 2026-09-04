import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WovenRule } from "@/components/woven-rule";
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
      <div className="space-y-3">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold text-foreground">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("summary")}</p>
        </div>
        <WovenRule className="max-w-24" />
      </div>

      <StaffTable />
    </div>
  );
}
