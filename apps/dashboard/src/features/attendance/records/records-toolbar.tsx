"use client";

import { useTranslations } from "next-intl";

import { Toolbar, ToolbarHeading } from "@/app/(app)/shell/toolbar";

/** The Records page's title and summary. */
export function RecordsToolbar() {
  const t = useTranslations("attendance");

  return (
    <Toolbar>
      <ToolbarHeading title={t("records.title")} description={t("records.summary")} />
    </Toolbar>
  );
}
