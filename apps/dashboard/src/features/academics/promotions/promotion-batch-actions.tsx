"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, Button } from "@schoolhub/ui";

import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import type { PromotionAction, PromotionBatchDetail } from "@/services";
import {
  PROMOTION_ACTION,
  PROMOTION_ACTION_PERMISSION,
  PROMOTION_DESTRUCTIVE_ACTIONS,
  PROMOTION_SECTION_ADVISORY_STATUSES,
  PROMOTION_STATUS,
  PROMOTION_STATUS_ACTIONS,
} from "@/services/modules/promotions/promotions-constant";
import { countMissingSections } from "@/services/modules/promotions/promotions-helper";
import { PromotionExecutionReportCard } from "./promotion-execution-report";
import { PromotionTransitionDialog } from "./promotion-transition-dialog";
import { usePromotionExecution } from "./use-promotion-execution";

export interface PromotionBatchActionsProps {
  batch: PromotionBatchDetail;
}

/**
 * What the viewer can do to the batch now: the buttons its status offers (the matrix is
 * `PROMOTION_STATUS_ACTIONS`) that its permission keys allow, each behind a confirm dialog. While
 * the viewer's permissions load, and if they fail to, there are none. It also shows the
 * execution's progress, outcome and per-student report, which outlive the Execute dialog, and
 * the advisory about students who would fail on execute for want of a target section.
 */
export function PromotionBatchActions({ batch }: PromotionBatchActionsProps) {
  const t = useTranslations("academics");
  const tCommon = useTranslations("common");
  const { data: currentUser } = useCurrentUser();
  const execution = usePromotionExecution(batch.batch_id);
  const [pendingAction, setPendingAction] = useState<PromotionAction | null>(null);

  const actions = PROMOTION_STATUS_ACTIONS[batch.status].filter((action) =>
    hasPermission(currentUser, PROMOTION_ACTION_PERMISSION[action]),
  );
  // Advisory, never a gate: the server decides what executes. Only a draft can still set a section.
  const missingSections = PROMOTION_SECTION_ADVISORY_STATUSES.includes(batch.status)
    ? countMissingSections(batch.decisions)
    : 0;
  const advisoryKey =
    batch.status === PROMOTION_STATUS.approved ? "missingSectionsApproved" : "missingSections";
  // A succeeded job leaves Execute disabled until the refetched status takes the button away.
  const isExecuteBlocked = execution.isRunning || execution.hasSucceeded;

  function onDialogOpenChange(open: boolean) {
    if (!open) setPendingAction(null);
  }

  return (
    // `empty:hidden`: with nothing to offer or say it leaves no gap above the table.
    <div className="space-y-4 empty:hidden">
      {missingSections > 0 && (
        <Alert variant="warning" appearance="light">
          <AlertDescription>
            {t(`promotions.review.${advisoryKey}`, { count: missingSections })}
          </AlertDescription>
        </Alert>
      )}

      {actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2.5">
          {actions.map((action) => {
            const isExecute = action === PROMOTION_ACTION.execute;
            return (
              <Button
                key={action}
                variant={
                  PROMOTION_DESTRUCTIVE_ACTIONS.includes(action) ? "outline-danger" : "primary"
                }
                disabled={isExecute ? isExecuteBlocked : execution.isRunning}
                isLoading={isExecute && execution.isRunning && !execution.isStalled}
                loadingLabel={tCommon("loading")}
                onClick={() => {
                  setPendingAction(action);
                }}
              >
                {t(`promotions.actions.${action}`)}
              </Button>
            );
          })}
        </div>
      )}

      {execution.isRunning && !execution.isStalled && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("promotions.report.running", { progress: execution.progress })}
        </p>
      )}
      {execution.isStalled && (
        <Alert variant="warning" appearance="light">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            {t("promotions.report.stalled")}
            <Button variant="outline" size="sm" onClick={execution.resume}>
              {t("promotions.report.resume")}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {execution.hasFailed && (
        <Alert variant="destructive" appearance="light">
          <AlertDescription>{t("promotions.report.jobFailed")}</AlertDescription>
        </Alert>
      )}
      {execution.report && (
        <PromotionExecutionReportCard report={execution.report} decisions={batch.decisions} />
      )}

      {pendingAction === PROMOTION_ACTION.execute && (
        <PromotionTransitionDialog
          open
          onOpenChange={onDialogOpenChange}
          batchId={batch.batch_id}
          action={PROMOTION_ACTION.execute}
          onExecute={execution.start}
        />
      )}
      {pendingAction !== null && pendingAction !== PROMOTION_ACTION.execute && (
        <PromotionTransitionDialog
          open
          onOpenChange={onDialogOpenChange}
          batchId={batch.batch_id}
          action={pendingAction}
        />
      )}
    </div>
  );
}
