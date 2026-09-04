import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WovenRule } from "@/components/woven-rule";
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
      <div className="space-y-3">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            {t("form.editTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("summary")}</p>
        </div>
        <WovenRule className="max-w-24" />
      </div>

      <EditStaffForm staffId={staffId} />
    </div>
  );
}
