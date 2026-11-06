"use client";

import { EmptyState, Skeleton } from "@schoolhub/ui";
import { Users } from "lucide-react";
import { useTranslations } from "next-intl";

import { usePortalSummary } from "@/features/portal/use-portal-summary";
import { ChildCard } from "./child-card";

/** `/portal`: one card per child from the summary. */
export function PortalHome() {
  const t = useTranslations("portal.home");
  const summary = usePortalSummary();

  if (summary.isPending) return <Skeleton className="h-40 w-full" />;
  // The shell already shows the summary's load error and retry; render nothing under it.
  if (summary.isError) return null;
  if (summary.data.children.length === 0) {
    return <EmptyState icon={Users} title={t("emptyTitle")} description={t("emptyDescription")} />;
  }
  return (
    <section className="space-y-4">
      <h1 className="font-heading text-xl font-semibold text-foreground">{t("title")}</h1>
      {summary.data.children.map((child) => (
        <ChildCard key={child.student.id} child={child} />
      ))}
    </section>
  );
}
