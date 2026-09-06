import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ScreenHeader } from "@/components/screen-header";
import { StaffForm } from "@/features/staff/staff-form";

export const metadata: Metadata = { title: "New staff member" };

export default async function NewStaffPage() {
  const t = await getTranslations("staff");

  return (
    <div className="space-y-6">
      <ScreenHeader title={t("form.createTitle")} description={t("summary")} />

      <StaffForm mode="create" />
    </div>
  );
}
