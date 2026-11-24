"use client";

import { Suspense } from "react";
import { useTranslations } from "next-intl";

import { DEPARTMENT_KEYS } from "@/features/school/school-permissions";
import { SectionToolbar } from "@/components/section-toolbar";
import { DepartmentFormDialog } from "./department-form-dialog";
import { DepartmentsTable } from "./departments-table";

/** The Departments section as one unit (title, Add, the list and its dialogs), for the School
 * page and the onboarding wizard alike. */
export function DepartmentsSection() {
  const t = useTranslations("school");
  return (
    <div className="space-y-5">
      <SectionToolbar
        title={t("departments.title")}
        description={t("departments.summary")}
        addLabel={t("departments.actions.create")}
        createKey={DEPARTMENT_KEYS.create}
        renderAddDialog={(onOpenChange) => (
          <DepartmentFormDialog open onOpenChange={onOpenChange} />
        )}
      />
      <Suspense>
        <DepartmentsTable />
      </Suspense>
    </div>
  );
}
