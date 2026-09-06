import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ScreenHeader } from "@/components/screen-header";
import { CurriculumScreen } from "@/features/academics/curriculum-screen";

export const metadata: Metadata = { title: "Curriculum" };

/**
 * Async server component: static chrome renders on the server, and the
 * tenant-scoped curriculum grid streams in from the client component below (it
 * needs the user's access token, which by design never leaves the browser's
 * memory) — same split as staff/page.tsx and students/page.tsx.
 */
export default async function AcademicsPage() {
  const t = await getTranslations("academics");

  return (
    <div className="space-y-6">
      <ScreenHeader title={t("curriculum.title")} description={t("curriculum.summary")} />

      <CurriculumScreen />
    </div>
  );
}
