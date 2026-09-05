"use client";

import { fetchPage } from "@schoolhub/api-client";
import {
  Badge,
  DataTable,
  type DataTableColumn,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@schoolhub/ui";
import { isCursorPagination } from "@schoolhub/types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Can } from "@/components/can";
import {
  ACADEMICS_PAGE_SIZE,
  ALL,
  PROMOTION_STATUSES,
  PROMOTION_STATUS_BADGE,
} from "@/features/academics/academics-constants";
import { ApiErrorAlert } from "@/features/academics/academics-error-alert";
import { AcademicsNav } from "@/features/academics/academics-nav";
import type { PromotionDecisionRecord } from "@/features/academics/academics-types";
import { PromotionBatchForm } from "@/features/academics/promotion-batch-form";
import { useAcademicSessions, useClasses } from "@/features/students/use-reference-data";
import { useCursorPager } from "@/hooks/use-cursor-pager";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

const EMPTY = "—";

/**
 * Promotion decisions across batches, and the entry point for creating one.
 *
 * The API has no batch resource to list — `batch_id` is a logical grouping over
 * `student_promotions` rows — so this lists the rows and each one links to its
 * batch's review table. Filtering by session pair and class is what narrows it to
 * "the batch I mean", which is exactly the filter set §16 gives this endpoint.
 */
export function PromotionBatchesScreen() {
  const t = useTranslations("academics");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const pager = useCursorPager();

  const sessions = useAcademicSessions();
  const classes = useClasses();

  const [fromSessionId, setFromSessionId] = useState<string>(ALL);
  const [toSessionId, setToSessionId] = useState<string>(ALL);
  const [classId, setClassId] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);

  const filters = useMemo(
    () => ({
      ...(fromSessionId !== ALL ? { from_academic_session_id: fromSessionId } : {}),
      ...(toSessionId !== ALL ? { to_academic_session_id: toSessionId } : {}),
      ...(classId !== ALL ? { from_class_id: classId } : {}),
      ...(status !== ALL ? { status } : {}),
    }),
    [fromSessionId, toSessionId, classId, status],
  );
  pager.syncFilterKey(JSON.stringify(filters));

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: queryKeys.list("academics", "student-promotions", {
      ...filters,
      cursor: pager.cursor,
    }),
    queryFn: () =>
      fetchPage<PromotionDecisionRecord>(apiClient, "/student-promotions", {
        query: {
          ...filters,
          ...(pager.cursor ? { cursor: pager.cursor } : {}),
          page_size: ACADEMICS_PAGE_SIZE,
        },
      }),
    placeholderData: keepPreviousData,
  });

  const sessionNames = useMemo(
    () => new Map((sessions.data ?? []).map((session) => [session.id, session.name])),
    [sessions.data],
  );
  const classNames = useMemo(
    () => new Map((classes.data ?? []).map((option) => [option.id, option.name])),
    [classes.data],
  );

  const rows = data?.items ?? [];
  const pagination =
    data?.pagination && isCursorPagination(data.pagination) ? data.pagination : undefined;

  const columns: DataTableColumn<PromotionDecisionRecord>[] = [
    {
      id: "batch",
      header: t("promotions.columns.batch"),
      className: "tabular-nums",
      cell: (row) => row.batch_id,
    },
    {
      id: "class",
      header: t("promotions.columns.fromClass"),
      cell: (row) => classNames.get(row.from_class_id) ?? EMPTY,
    },
    {
      id: "sessions",
      header: t("promotions.columns.sessions"),
      cell: (row) =>
        t("promotions.sessionPair", {
          from: sessionNames.get(row.from_academic_session_id) ?? EMPTY,
          to: sessionNames.get(row.to_academic_session_id) ?? EMPTY,
        }),
    },
    {
      id: "decision",
      header: t("promotions.columns.decision"),
      cell: (row) => t(`promotions.decisionValue.${row.decision}`),
    },
    {
      id: "status",
      header: t("promotions.columns.status"),
      cell: (row) => (
        <Badge variant={PROMOTION_STATUS_BADGE[row.status]}>
          {t(`promotions.status.${row.status}`)}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <AcademicsNav />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Can permission="academics.promotion.create">
          <PromotionBatchForm />
        </Can>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            {t("promotions.fields.fromSession")}
          </span>
          <Select value={fromSessionId} onValueChange={setFromSessionId}>
            <SelectTrigger aria-label={t("promotions.fields.fromSession")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
              {(sessions.data ?? []).map((session) => (
                <SelectItem key={session.id} value={session.id}>
                  {session.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-44 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            {t("promotions.fields.toSession")}
          </span>
          <Select value={toSessionId} onValueChange={setToSessionId}>
            <SelectTrigger aria-label={t("promotions.fields.toSession")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
              {(sessions.data ?? []).map((session) => (
                <SelectItem key={session.id} value={session.id}>
                  {session.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">{t("fields.class")}</span>
          <Select value={classId} onValueChange={setClassId}>
            <SelectTrigger aria-label={t("fields.class")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
              {(classes.data ?? []).map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            {t("promotions.columns.status")}
          </span>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger aria-label={t("promotions.columns.status")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
              {PROMOTION_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`promotions.status.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error ? (
        <ApiErrorAlert error={error} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          caption={t("promotions.list.caption")}
          isLoading={isPending}
          emptyState={t("promotions.list.empty")}
          onRowClick={(row) => {
            router.push(`/academics/promotions/${row.batch_id}`);
          }}
          pagination={{
            hasNext: Boolean(pagination?.next_cursor),
            hasPrevious: pager.hasPrevious,
            onNext: () => {
              if (!isFetching) pager.onNext(pagination);
            },
            onPrevious: () => {
              if (!isFetching) pager.onPrevious();
            },
            nextLabel: tCommon("next"),
            previousLabel: tCommon("previous"),
          }}
        />
      )}
    </div>
  );
}
