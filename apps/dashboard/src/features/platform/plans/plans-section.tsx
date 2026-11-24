"use client";

import { Suspense } from "react";
import { useTranslations } from "next-intl";

import { SectionToolbar } from "@/components/section-toolbar";
import { PLATFORM_KEYS } from "@/features/platform/platform-permissions";
import { PlanFormDialog } from "./plan-form-dialog";
import { PlansTable } from "./plans-table";

/** The plan catalog as one unit: title, New plan, and the list with its dialogs. The table reads
 * the URL, so it sits in a Suspense boundary. */
export function PlansSection() {
  const t = useTranslations("platform");
  return (
    <div className="space-y-5">
      <SectionToolbar
        title={t("plans.title")}
        description={t("plans.summary")}
        addLabel={t("plans.create")}
        createKey={PLATFORM_KEYS.planCreate}
        renderAddDialog={(onOpenChange) => <PlanFormDialog open onOpenChange={onOpenChange} />}
      />
      <Suspense>
        <PlansTable />
      </Suspense>
    </div>
  );
}
