"use client";

import { Badge, Button, Card, CardContent, DataTable, type DataTableColumn } from "@schoolhub/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo } from "react";
import { Can } from "@/components/can";
import { PROMOTION_STATUS_BADGE } from "@/features/academics/academics-constants";
import { ApiErrorAlert } from "@/features/academics/academics-error-alert";
import { AcademicsNav } from "@/features/academics/academics-nav";
import type {
  PromotionBatchDetail,
  PromotionDecisionRecord,
} from "@/features/academics/academics-types";
import { PromotionBatchActions } from "@/features/academics/promotion-batch-actions";
import { PromotionDecisionForm } from "@/features/academics/promotion-decision-form";
import { useSections } from "@/features/academics/use-academics-reference-data";
import { useClasses } from "@/features/students/use-reference-data";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

interface PromotionBatchReviewProps {
  batchId: string;
}

const EMPTY = "—";

/**
 * One batch's per-student decisions (§7.2's review step).
 *
 * There is no batch resource to fetch: `batch_id` is a logical grouping over
 * `student_promotions` rows (the entity doc settles this — "no separate batch
 * table"), and status moves batch-wide, so the batch's state is read off the rows
 * themselves. The first row is authoritative because every row in a batch
 * transitions together.
 *
 * Rows are editable only while the batch is `draft`: the viewset answers a PATCH
 * of anything further along with a 409, so offering the control would be a lie.
 */
export function PromotionBatchReview({ batchId }: PromotionBatchReviewProps) {
  const t = useTranslations("academics");

  const classes = useClasses();
  const sections = useSections();

  // One request for the batch and its decisions. This used to list decision
  // rows filtered by `batch_id` and read the batch's status off `rows[0]`,
  // because there was no batch resource — there is one now.
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.detail("academics", "student-promotions", batchId),
    queryFn: async () => {
      const result = await apiClient.get<PromotionBatchDetail>(`/student-promotions/${batchId}`);
      return result.data;
    },
    placeholderData: keepPreviousData,
  });

  const classNames = useMemo(
    () => new Map((classes.data ?? []).map((option) => [option.id, option.name])),
    [classes.data],
  );
  const sectionNames = useMemo(
    () => new Map((sections.data ?? []).map((section) => [section.id, section.name])),
    [sections.data],
  );

  const rows = data?.decisions ?? [];
  const status = rows[0]?.status;
  const isDraft = status === "draft";

  const columns: DataTableColumn<PromotionDecisionRecord>[] = [
    {
      id: "student",
      header: t("promotions.columns.student"),
      cell: (row) => (
        // The serializer exposes only `student_id`, so the id is the label. A link
        // to the student's own screen is the honest way to make it useful.
        <Link
          href={`/students/${row.student_id}`}
          className="text-primary underline-offset-4 hover:underline"
        >
          {row.student_id}
        </Link>
      ),
    },
    {
      id: "fromClass",
      header: t("promotions.columns.fromClass"),
      cell: (row) => classNames.get(row.from_class_id) ?? EMPTY,
    },
    {
      id: "decision",
      header: t("promotions.columns.decision"),
      cell: (row) => t(`promotions.decisionValue.${row.decision}`),
    },
    {
      id: "toClass",
      header: t("promotions.fields.toClass"),
      cell: (row) => (row.to_class_id ? (classNames.get(row.to_class_id) ?? EMPTY) : EMPTY),
    },
    {
      id: "toSection",
      header: t("promotions.fields.toSection"),
      cell: (row) => (row.to_section_id ? (sectionNames.get(row.to_section_id) ?? EMPTY) : EMPTY),
    },
    {
      id: "remarks",
      header: t("promotions.fields.remarks"),
      cell: (row) => row.remarks ?? EMPTY,
    },
    {
      id: "actions",
      header: "",
      srLabel: t("promotions.columns.actions"),
      className: "text-end",
      cell: (row) =>
        isDraft ? (
          <div className="flex justify-end">
            <Can permission="academics.promotion.update">
              <PromotionDecisionForm decision={row} studentLabel={row.student_id} />
            </Can>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <AcademicsNav />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground tabular-nums">{batchId}</span>
          {status ? (
            <Badge variant={PROMOTION_STATUS_BADGE[status]}>
              {t(`promotions.status.${status}`)}
            </Badge>
          ) : null}
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/academics/promotions">{t("promotions.actions.backToList")}</Link>
        </Button>
      </div>

      {error ? <ApiErrorAlert error={error} /> : null}

      {status ? (
        <Card>
          <CardContent className="pt-6">
            <PromotionBatchActions batchId={batchId} status={status} />
          </CardContent>
        </Card>
      ) : null}

      {error ? null : (
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          caption={t("promotions.review.caption")}
          isLoading={isPending}
          emptyState={t("promotions.review.empty")}
          // No pagination: a batch is one class, and `GET /student-promotions/{id}`
          // returns its decisions inline. Paging forty rows would cost a request
          // per page to hide nothing.
        />
      )}
    </div>
  );
}
