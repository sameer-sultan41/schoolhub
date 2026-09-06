import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ScreenHeader } from "@/components/screen-header";
import { EditStaffForm } from "@/features/staff/edit-staff-form";

export const metadata: Metadata = { title: "Edit staff member" };

interface EditStaffPageProps {
  params: Promise<{ staffId: string }>;
}

export default async function EditStaffPage({ params }: EditStaffPageProps) {
  const { staffId } = await params;
  const t = await getTranslations("staff");

  return (
    <div className="space-y-6">
      <ScreenHeader title={t("form.editTitle")} description={t("summary")} />

      <EditStaffForm staffId={staffId} />
    </div>
  );
}
