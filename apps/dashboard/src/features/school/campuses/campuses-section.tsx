"use client";

import { Suspense } from "react";
import { useTranslations } from "next-intl";

import { CAMPUS_KEYS } from "@/features/school/school-permissions";
import { StructureToolbar } from "@/features/school/shared/structure-toolbar";
import { CampusFormDialog } from "./campus-form-dialog";
import { CampusesTable } from "./campuses-table";

/**
 * The Campuses section as one unit (title, Add, the list and its dialogs), so the School page
 * and the onboarding wizard embed the same thing. The table reads the URL
 * (`useSearchParams`), so it sits in a Suspense boundary.
 */
export function CampusesSection() {
  const t = useTranslations("school");
  return (
    <div className="space-y-5">
      <StructureToolbar
        title={t("campuses.title")}
        description={t("campuses.summary")}
        addLabel={t("campuses.actions.create")}
        createKey={CAMPUS_KEYS.create}
        renderAddDialog={(onOpenChange) => <CampusFormDialog open onOpenChange={onOpenChange} />}
      />
      <Suspense>
        <CampusesTable />
      </Suspense>
    </div>
  );
}
