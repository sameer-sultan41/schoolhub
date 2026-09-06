import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ScreenHeader } from "@/components/screen-header";
import { EditStudentForm } from "@/features/students/edit-student-form";

export const metadata: Metadata = { title: "Edit student" };

interface EditStudentPageProps {
  params: Promise<{ studentId: string }>;
}

export default async function EditStudentPage({ params }: EditStudentPageProps) {
  const { studentId } = await params;
  const t = await getTranslations("students");

  return (
    <div className="space-y-6">
      <ScreenHeader title={t("form.editTitle")} description={t("summary")} />

      <EditStudentForm studentId={studentId} />
    </div>
  );
}
