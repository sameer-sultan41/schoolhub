"use client";

import { Suspense } from "react";
import { useTranslations } from "next-intl";

import { SESSION_KEYS } from "@/features/school/school-permissions";
import { StructureToolbar } from "@/features/school/shared/structure-toolbar";
import { SessionFormDialog } from "./session-form-dialog";
import { SessionsTable } from "./sessions-table";

/** The Sessions section as one unit (title, Add, the list with each session's terms, and its
 * dialogs), for the School page and the onboarding wizard alike. */
export function SessionsSection() {
  const t = useTranslations("school");
  return (
    <div className="space-y-5">
      <StructureToolbar
        title={t("sessions.title")}
        description={t("sessions.summary")}
        addLabel={t("sessions.actions.create")}
        createKey={SESSION_KEYS.create}
        renderAddDialog={(onOpenChange) => <SessionFormDialog open onOpenChange={onOpenChange} />}
      />
      <Suspense>
        <SessionsTable />
      </Suspense>
    </div>
  );
}
