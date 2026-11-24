"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type PlanRecord } from "@/services";
import { PLATFORM_QUERY_MODULE } from "@/services/modules/platform/platform-constant";

/**
 * Retires a plan (a soft delete): it takes no new subscriber. A plan a school is still on is a
 * 409 `plan_in_use`, shown inline. Mounting contract: mounted only while open.
 */
export function RetirePlanDialog({
  plan,
  onOpenChange,
}: {
  plan: PlanRecord;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("platform");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(PLATFORM_QUERY_MODULE);

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: () => Services.platform.retirePlan(plan.id),
    onSuccess: () => {
      invalidate();
      toast.success(t("plans.retire.done", { name: plan.name }));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open
      onOpenChange={onOpenChange}
      title={t("plans.retire.title", { name: plan.name })}
      description={t("plans.retire.description")}
      confirmLabel={t("plans.retire.confirm")}
      variant="destructive"
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
