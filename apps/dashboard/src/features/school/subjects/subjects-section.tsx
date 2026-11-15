"use client";

import { Suspense } from "react";
import { useTranslations } from "next-intl";

import { SUBJECT_KEYS } from "@/features/school/school-permissions";
import { StructureToolbar } from "@/features/school/shared/structure-toolbar";
import { SubjectFormDialog } from "./subject-form-dialog";
import { SubjectsTable } from "./subjects-table";

/** The Subjects section as one unit (title, Add, the list and its dialogs), for the School page
 * and the onboarding wizard alike. */
export function SubjectsSection() {
  const t = useTranslations("school");
  return (
    <div className="space-y-5">
      <StructureToolbar
        title={t("subjects.title")}
        description={t("subjects.summary")}
        addLabel={t("subjects.actions.create")}
        createKey={SUBJECT_KEYS.create}
        renderAddDialog={(onOpenChange) => <SubjectFormDialog open onOpenChange={onOpenChange} />}
      />
      <Suspense>
        <SubjectsTable />
      </Suspense>
    </div>
  );
}
