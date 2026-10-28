"use client";

import { useTranslations } from "next-intl";

import { Toolbar, ToolbarHeading } from "@/app/(app)/shell/toolbar";

/** The Corrections page's title and summary. */
export function CorrectionsToolbar() {
  const t = useTranslations("attendance");

  return (
    <Toolbar>
      <ToolbarHeading title={t("corrections.title")} description={t("corrections.summary")} />
    </Toolbar>
  );
}
