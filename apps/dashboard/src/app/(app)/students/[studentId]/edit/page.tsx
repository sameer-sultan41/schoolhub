import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WovenRule } from "@/components/woven-rule";
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
      <div className="space-y-3">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            {t("form.editTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("summary")}</p>
        </div>
        <WovenRule className="max-w-24" />
      </div>

      <EditStudentForm studentId={studentId} />
    </div>
  );
}
