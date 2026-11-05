"use client";

import { EmptyState, Skeleton } from "@schoolhub/ui";
import { Users } from "lucide-react";
import { useTranslations } from "next-intl";

import { useSelectedChild } from "@/features/portal/shell/use-selected-child";
import { usePortalSummary } from "@/features/portal/use-portal-summary";
import { ChildCard } from "./child-card";

/** `/portal/[studentId]`: the selected child's card. A segment that is not one of the viewer's
 * children says so; the child's own pages answer 404 for it. */
export function ChildOverview() {
  const t = useTranslations("portal.home");
  const summary = usePortalSummary();
  const { child } = useSelectedChild(summary.data?.children);

  if (summary.isPending) return <Skeleton className="h-40 w-full" />;
  // The shell already shows the summary's load error and retry.
  if (summary.isError) return null;
  if (child === undefined) {
    return (
      <EmptyState icon={Users} title={t("notFoundTitle")} description={t("notFoundDescription")} />
    );
  }
  return <ChildCard child={child} linked={false} />;
}
