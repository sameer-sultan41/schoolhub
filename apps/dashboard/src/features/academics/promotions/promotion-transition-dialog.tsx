"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { Services, type PromotionTransition } from "@/services";
import {
  PROMOTION_ACTION,
  PROMOTION_DESTRUCTIVE_ACTIONS,
} from "@/services/modules/promotions/promotions-constant";
import { usePromotionBatchCache } from "./use-promotion-batch-cache";

interface PromotionTransitionDialogBaseProps {
  batchId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** A transition is sent here; `execute` is queued by the execution hook, which owns its job. */
export type PromotionTransitionDialogProps = PromotionTransitionDialogBaseProps &
  (
    | { action: PromotionTransition }
    | { action: typeof PROMOTION_ACTION.execute; onExecute: () => Promise<void> }
  );

/**
 * Confirms one step of a batch's lifecycle (submit, approve, reject, revert or execute). The
 * confirm button reads as the button that opened it. A refusal (the preparer approving their own
 * batch, an override reason missing for some students, a status race) shows inline and the
 * dialog stays open; a `409` also reloads the batch, so the page behind shows its real status.
 *
 * The idempotency key is one per dialog instance, but only `:execute` replays it on the server:
 * a transition retried after a lost response runs again and can come back `409`, which is what
 * the refetch is for. Executing is the execution hook's request, kept apart because the job it
 * queues outlives this dialog.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts with a
 * fresh key and no stale error.
 */
export function PromotionTransitionDialog(props: PromotionTransitionDialogProps) {
  const { batchId, open, onOpenChange } = props;
  const t = useTranslations("academics");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const { refreshBatchAndList, refreshOnConflict } = usePromotionBatchCache(batchId);

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: async (): Promise<void> => {
      if (props.action === PROMOTION_ACTION.execute) {
        await props.onExecute();
        return;
      }
      const { action } = props;
      await refreshOnConflict(() =>
        Services.promotions.transitionBatch(batchId, action, idempotencyKey),
      );
    },
    onSuccess: () => {
      // Queueing an execution changes nothing yet: its job reloads the batch when it ends.
      if (props.action !== PROMOTION_ACTION.execute) refreshBatchAndList();
      onOpenChange(false);
    },
    fallbackMessage: t("common.submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t(`promotions.transition.${props.action}.title`)}
      description={t(`promotions.transition.${props.action}.description`)}
      confirmLabel={t(`promotions.actions.${props.action}`)}
      variant={PROMOTION_DESTRUCTIVE_ACTIONS.includes(props.action) ? "destructive" : undefined}
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
