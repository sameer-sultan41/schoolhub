"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type FeeStructureRecord } from "@/services";
import { FEE_STRUCTURES_QUERY_MODULE } from "@/services/modules/fee-structures/fee-structures-constant";

export type StructureLifecycleAction = "activate" | "archive";

export interface StructureLifecycleDialogProps {
  action: StructureLifecycleAction;
  structure: FeeStructureRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Activates a draft structure or archives an active one (`:activate`, `:archive`). The server's
 * refusal (422: no schedules, or another active structure at the same scope) shows inline and
 * the dialog stays open.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts with
 * no stale error.
 */
export function StructureLifecycleDialog({
  action,
  structure,
  open,
  onOpenChange,
}: StructureLifecycleDialogProps) {
  const t = useTranslations("fees");
  const tCommon = useTranslations("common");
  const invalidateStructures = useInvalidateModule(FEE_STRUCTURES_QUERY_MODULE);

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: () =>
      action === "activate"
        ? Services.feeStructures.activateFeeStructure(structure.id)
        : Services.feeStructures.archiveFeeStructure(structure.id),
    onSuccess: () => {
      invalidateStructures();
      toast.success(t(action === "activate" ? "structures.activated" : "structures.archivedToast"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t(`structures.lifecycle.${action}Title`, { name: structure.name })}
      description={t(`structures.lifecycle.${action}Description`)}
      confirmLabel={t(`structures.actions.${action}`)}
      variant={action === "archive" ? "destructive" : undefined}
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
