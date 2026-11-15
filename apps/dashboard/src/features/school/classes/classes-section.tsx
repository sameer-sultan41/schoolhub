"use client";

import { Suspense } from "react";
import { useTranslations } from "next-intl";

import { CLASS_KEYS } from "@/features/school/school-permissions";
import { StructureToolbar } from "@/features/school/shared/structure-toolbar";
import { ClassFormDialog } from "./class-form-dialog";
import { ClassesTable } from "./classes-table";

/** The Classes & sections section as one unit (title, Add class, the classes with their sections
 * and every dialog), for the School page and the onboarding wizard alike. */
export function ClassesSection() {
  const t = useTranslations("school");
  return (
    <div className="space-y-5">
      <StructureToolbar
        title={t("classes.title")}
        description={t("classes.summary")}
        addLabel={t("classes.actions.create")}
        createKey={CLASS_KEYS.create}
        renderAddDialog={(onOpenChange) => <ClassFormDialog open onOpenChange={onOpenChange} />}
      />
      <Suspense>
        <ClassesTable />
      </Suspense>
    </div>
  );
}
