import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WovenRule } from "@/components/woven-rule";
import { StaffForm } from "@/features/staff/staff-form";

export const metadata: Metadata = { title: "New staff member" };

export default async function NewStaffPage() {
  const t = await getTranslations("staff");

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

      <StaffForm mode="create" />
    </div>
  );
}
