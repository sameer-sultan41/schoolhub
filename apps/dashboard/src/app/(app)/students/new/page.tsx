import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ScreenHeader } from "@/components/screen-header";
import { StudentForm } from "@/features/students/student-form";

export const metadata: Metadata = { title: "New student" };

export default async function NewStudentPage() {
  const t = await getTranslations("students");

  return (
    <div className="space-y-6">
      <ScreenHeader title={t("form.createTitle")} description={t("summary")} />

      <StudentForm mode="create" />
    </div>
  );
}
