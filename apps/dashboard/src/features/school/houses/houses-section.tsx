"use client";

import { Suspense } from "react";
import { useTranslations } from "next-intl";

import { HOUSE_KEYS } from "@/features/school/school-permissions";
import { SectionToolbar } from "@/components/section-toolbar";
import { HouseFormDialog } from "./house-form-dialog";
import { HousesTable } from "./houses-table";

/** The Houses section as one unit (title, Add, the list and its dialogs), for the School page
 * and the onboarding wizard alike. */
export function HousesSection() {
  const t = useTranslations("school");
  return (
    <div className="space-y-5">
      <SectionToolbar
        title={t("houses.title")}
        description={t("houses.summary")}
        addLabel={t("houses.actions.create")}
        createKey={HOUSE_KEYS.create}
        renderAddDialog={(onOpenChange) => <HouseFormDialog open onOpenChange={onOpenChange} />}
      />
      <Suspense>
        <HousesTable />
      </Suspense>
    </div>
  );
}
