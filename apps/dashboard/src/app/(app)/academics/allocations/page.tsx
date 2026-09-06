import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ScreenHeader } from "@/components/screen-header";
import { AllocationsScreen } from "@/features/academics/allocations-screen";

export const metadata: Metadata = { title: "Teacher allocation" };

export default async function AcademicsAllocationsPage() {
  const t = await getTranslations("academics");

  return (
    <div className="space-y-6">
      <ScreenHeader title={t("allocations.title")} description={t("allocations.summary")} />

      <AllocationsScreen />
    </div>
  );
}
