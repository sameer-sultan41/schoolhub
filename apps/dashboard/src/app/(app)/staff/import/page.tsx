import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ScreenHeader } from "@/components/screen-header";
import { ImportWizard } from "@/features/staff/import-wizard";

export const metadata: Metadata = { title: "Import staff" };

export default async function ImportStaffPage() {
  const t = await getTranslations("staff");

  return (
    <div className="space-y-6">
      <ScreenHeader title={t("import.title")} description={t("import.description")} />

      <ImportWizard />
    </div>
  );
}
