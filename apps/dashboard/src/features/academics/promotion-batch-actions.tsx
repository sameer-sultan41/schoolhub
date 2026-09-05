"use client";

import { Alert, AlertDescription, Button, Card, CardContent } from "@schoolhub/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Can } from "@/components/can";
import { ApiErrorAlert } from "@/features/academics/academics-error-alert";
import type {
  PromotionActionResult,
  PromotionExecutionReport,
  PromotionStatusValue,
} from "@/features/academics/academics-types";
import { newIdempotencyKey } from "@/features/academics/idempotency-key";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

interface PromotionBatchActionsProps {
  batchId: string;
  status: PromotionStatusValue;
}

/**
 * The §7.2 state machine, as buttons: `draft → pending_approval → approved →
 * executed`, with `reverted` reachable before downstream data exists.
 *
 * Only the transitions the current state allows are rendered, and each is also
 * behind its own permission key — `<Can>` hides, the API enforces. Notably
 * `:approve` and `:reject` share `academics.promotion.approve`, and the server
 * additionally refuses an approver who prepared the batch (RBAC §2.4), which no
 * amount of client-side gating can know.
 */
export function PromotionBatchActions({ batchId, status }: PromotionBatchActionsProps) {
  const t = useTranslations("academics");
  const queryClient = useQueryClient();

  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [report, setReport] = useState<PromotionExecutionReport | null>(null);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.module("academics") });
  }

  const transition = useMutation({
    mutationFn: (action: "submit" | "approve" | "reject" | "revert") =>
      apiClient.post<PromotionActionResult>(`/student-promotions/${batchId}:${action}`),
    onSuccess: invalidate,
  });

  const execute = useMutation({
    mutationFn: async () => {
      const result = await apiClient.post<PromotionExecutionReport>(
        `/student-promotions/${batchId}:execute`,
        undefined,
        { idempotencyKey },
      );
      return result.data;
    },
    onSuccess: (result) => {
      invalidate();
      setReport(result);
      // A completed execution is a spent intent: a later re-run (after fixing a
      // failed row, say) is a new one and must not replay this response.
      setIdempotencyKey(newIdempotencyKey());
    },
  });

  const isBusy = transition.isPending || execute.isPending;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {status === "draft" ? (
          <Can permission="academics.promotion.update">
            <Button
              size="sm"
              disabled={isBusy}
              onClick={() => {
                transition.mutate("submit");
              }}
            >
              {t("promotions.actions.submit")}
            </Button>
          </Can>
        ) : null}

        {status === "pending_approval" ? (
          <Can permission="academics.promotion.approve">
            <Button
              size="sm"
              disabled={isBusy}
              onClick={() => {
                transition.mutate("approve");
              }}
            >
              {t("promotions.actions.approve")}
            </Button>
          </Can>
        ) : null}

        {status === "pending_approval" ? (
          <Can permission="academics.promotion.approve">
            <Button
              size="sm"
              variant="outline"
              disabled={isBusy}
              onClick={() => {
                transition.mutate("reject");
              }}
            >
              {t("promotions.actions.reject")}
            </Button>
          </Can>
        ) : null}

        {status === "approved" ? (
          <Can permission="academics.promotion.execute">
            <Button
              size="sm"
              disabled={isBusy}
              onClick={() => {
                execute.mutate();
              }}
            >
              {t("promotions.actions.execute")}
            </Button>
          </Can>
        ) : null}

        {status === "approved" || status === "executed" ? (
          <Can permission="academics.promotion.update">
            <Button
              size="sm"
              variant="danger"
              disabled={isBusy}
              onClick={() => {
                transition.mutate("revert");
              }}
            >
              {t("promotions.actions.revert")}
            </Button>
          </Can>
        ) : null}
      </div>

      <ApiErrorAlert error={transition.error} />
      <ApiErrorAlert error={execute.error} />

      {report ? <ExecutionReport report={report} /> : null}
    </div>
  );
}

/**
 * §7.2's "per-student result report". Rendered in full rather than reduced to a
 * count: one student failing a prerequisite must not be lost behind "3 of 30
 * succeeded", and `execute_batch` deliberately commits each student separately so
 * that the failures are individually actionable.
 */
function ExecutionReport({ report }: { report: PromotionExecutionReport }) {
  const t = useTranslations("academics");

  const groups = [
    { key: "enrolled" as const, rows: report.enrolled, variant: "success" as const },
    { key: "graduated" as const, rows: report.graduated, variant: "success" as const },
    { key: "skipped" as const, rows: report.skipped, variant: "warning" as const },
    { key: "failed" as const, rows: report.failed, variant: "danger" as const },
  ];

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <h3 className="text-sm font-medium text-foreground">{t("promotions.report.title")}</h3>
        {groups.map((group) => (
          <Alert key={group.key} variant={group.variant}>
            <AlertDescription>
              <span className="font-medium">
                {t(`promotions.report.${group.key}`, { count: group.rows.length })}
              </span>
              {group.rows.length > 0 ? (
                <ul className="mt-1 space-y-0.5 text-xs">
                  {group.rows.map((row) => (
                    <li key={row.student_id} className="tabular-nums">
                      {row.student_id}
                      {row.reason ? ` — ${row.reason}` : ""}
                      {row.error ? ` — ${row.error}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </AlertDescription>
          </Alert>
        ))}
      </CardContent>
    </Card>
  );
}
