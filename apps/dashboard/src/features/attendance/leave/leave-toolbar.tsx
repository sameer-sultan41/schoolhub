"use client";

import { useTranslations } from "next-intl";

import { Toolbar, ToolbarHeading } from "@/app/(app)/shell/toolbar";

/** The Leave page's title and summary. */
export function LeaveToolbar() {
  const t = useTranslations("attendance");

  return (
    <Toolbar>
      <ToolbarHeading title={t("leave.title")} description={t("leave.summary")} />
    </Toolbar>
  );
}
