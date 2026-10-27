"use client";

import { useTranslations } from "next-intl";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { ImportAttendanceButton } from "./import-attendance-button";

/** The Records page's title and summary, and Import for a holder of the import key. */
export function RecordsToolbar() {
  const t = useTranslations("attendance");

  return (
    <Toolbar>
      <ToolbarHeading title={t("records.title")} description={t("records.summary")} />
      <ToolbarActions>
        <ImportAttendanceButton />
      </ToolbarActions>
    </Toolbar>
  );
}
