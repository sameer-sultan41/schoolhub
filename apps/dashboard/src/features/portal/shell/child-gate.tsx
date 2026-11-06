"use client";

import type { ReactNode } from "react";
import { EmptyState, Skeleton } from "@schoolhub/ui";
import { Users } from "lucide-react";
import { useTranslations } from "next-intl";

import type { PortalChild } from "@/services";
import { usePortalSummary } from "@/features/portal/use-portal-summary";
import { useSelectedChild } from "./use-selected-child";

/** One child's page: waits for the summary, then renders `children` with the URL's child. A
 * `[studentId]` that is not one of the viewer's children gets the not-found state, and no
 * request is made for it. The shell owns the summary's load error. */
export function ChildGate({ children }: { children: (child: PortalChild) => ReactNode }) {
  const t = useTranslations("portal.home");
  const summary = usePortalSummary();
  const { child } = useSelectedChild(summary.data?.children);

  if (summary.isPending) return <Skeleton className="h-40 w-full" />;
  if (summary.isError) return null;
  if (child === undefined) {
    return (
      <EmptyState icon={Users} title={t("notFoundTitle")} description={t("notFoundDescription")} />
    );
  }
  return children(child);
}
