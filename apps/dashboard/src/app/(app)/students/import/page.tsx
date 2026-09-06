import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ScreenHeader } from "@/components/screen-header";
import { ImportWizard } from "@/features/students/import-wizard";

export const metadata: Metadata = { title: "Import students" };

export default async function ImportStudentsPage() {
  const t = await getTranslations("students");

  return (
    <div className="space-y-6">
      <ScreenHeader title={t("import.title")} description={t("import.description")} />

      <ImportWizard />
    </div>
  );
}
