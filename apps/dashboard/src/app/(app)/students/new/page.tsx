import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WovenRule } from "@/components/woven-rule";
import { StudentForm } from "@/features/students/student-form";

export const metadata: Metadata = { title: "New student" };

export default async function NewStudentPage() {
  const t = await getTranslations("students");

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            {t("form.createTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("summary")}</p>
        </div>
        <WovenRule className="max-w-24" />
      </div>

      <StudentForm mode="create" />
    </div>
  );
}
