"use client";

import { useTranslations } from "next-intl";
import { Card, EmptyState } from "@schoolhub/ui";
import { Upload } from "lucide-react";

import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { RecordsTable } from "./records-table";

/**
 * The Records body: the table for a holder of `attendance.student-attendance.view`, and for an
 * import-only holder (`it_admin`, §4) a note pointing at the toolbar's Import instead, so they
 * never load a list the API would refuse. Anyone else gets the table and the API's answer.
 */
export function RecordsScreen() {
  const t = useTranslations("attendance");
  const { data: currentUser } = useCurrentUser();

  if (!currentUser) return null;
  if (
    !hasPermission(currentUser, "attendance.student-attendance.view") &&
    hasPermission(currentUser, "attendance.student-attendance.import")
  ) {
    return (
      <Card>
        <EmptyState
          icon={Upload}
          title={t("records.importOnlyTitle")}
          description={t("records.importOnlyDescription")}
        />
      </Card>
    );
  }
  return <RecordsTable />;
}
