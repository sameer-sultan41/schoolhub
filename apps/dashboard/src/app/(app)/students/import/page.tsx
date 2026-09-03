import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WovenRule } from "@/components/woven-rule";
import { ImportWizard } from "@/features/students/import-wizard";

export const metadata: Metadata = { title: "Import students" };

export default async function ImportStudentsPage() {
  const t = await getTranslations("students");

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            {t("import.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("import.description")}</p>
        </div>
        <WovenRule className="max-w-24" />
      </div>

      <ImportWizard />
    </div>
  );
}
