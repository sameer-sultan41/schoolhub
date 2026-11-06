"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@schoolhub/ui";
import {
  CircleCheck,
  CircleDashed,
  ClipboardPen,
  Lock,
  PencilLine,
  type LucideIcon,
} from "lucide-react";

import { LoadErrorCard } from "@/components/load-error-card";
import { useCurrentUser } from "@/hooks/use-current-user";
import { resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import { Services, type ExamRecord, type MarksProgressRow } from "@/services";
import {
  needsUnlockToEdit,
  progressState,
  type MarksProgressState,
} from "@/services/modules/marks/marks-helper";
import { LockMarksButton } from "./lock-marks-button";
import { marksProgressKey } from "./marks-query-keys";

const COLUMN_KEYS = ["subject", "section", "entered", "submitted", "status"] as const;

const STATE_ICON: Record<MarksProgressState, LucideIcon> = {
  locked: Lock,
  submitted: CircleCheck,
  inProgress: PencilLine,
  notStarted: CircleDashed,
};

const STATE_VARIANT: Record<MarksProgressState, "secondary" | "success" | "info" | "warning"> = {
  locked: "secondary",
  submitted: "success",
  inProgress: "info",
  notStarted: "warning",
};

/** An exam's progress rows, under one key: the tab names the open grid from the same entry. */
export function useMarksProgress(examId: string) {
  return useQuery({
    queryKey: marksProgressKey(examId),
    queryFn: () => Services.marks.fetchProgress(examId),
  });
}

/** A row's state as token, icon and label together. */
function ProgressBadge({ row }: { row: MarksProgressRow }) {
  const t = useTranslations("exams");
  const state = progressState(row);
  const Icon = STATE_ICON[state];
  return (
    <Badge variant={STATE_VARIANT[state]} appearance="light">
      <Icon aria-hidden="true" />
      {t(`marks.progress.state.${state}`)}
    </Badge>
  );
}

export interface MarksProgressTableProps {
  exam: ExamRecord;
  onEnter: (row: MarksProgressRow) => void;
}

/**
 * The Marks tab's landing: one row per (exam-subject, section) the viewer may enter (every one
 * for an `all` scope), with its counts and state. Enter marks opens that grid. A holder of
 * `exams.marks.lock` gets Lock or Unlock. While the exam takes marks with any subject locked (a
 * send-back is one such case), the tab says a locked subject must be unlocked to be corrected.
 */
export function MarksProgressTable({ exam, onEnter }: MarksProgressTableProps) {
  const t = useTranslations("exams");
  const tErrors = useTranslations("errors");
  const { data: user } = useCurrentUser();
  const canLock = hasPermission(user, "exams.marks.lock");
  const query = useMarksProgress(exam.id);

  if (query.isError) {
    return (
      <LoadErrorCard
        message={resolveErrorMessage(query.error, tErrors, t("marks.progress.loadError"))}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  if (query.isPending) {
    return (
      <div role="status" className="space-y-3">
        <span className="sr-only">{t("marks.progress.loading")}</span>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const rows = query.data;
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={ClipboardPen}
        title={t("marks.progress.emptyTitle")}
        description={t("marks.progress.emptyDescription")}
      />
    );
  }

  return (
    <div className="space-y-4">
      {needsUnlockToEdit(exam.status, rows) && (
        <Alert variant="info" appearance="light">
          {t(canLock ? "marks.progress.unlockHint" : "marks.progress.unlockHintAsk")}
        </Alert>
      )}
      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableCaption className="sr-only">{t("marks.progress.caption")}</TableCaption>
          <TableHeader>
            <TableRow>
              {COLUMN_KEYS.map((key) => (
                <TableHead key={key}>{t(`marks.progress.columns.${key}`)}</TableHead>
              ))}
              <TableHead>{t("marks.progress.columns.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const section = t("marks.progress.sectionName", {
                class: row.class_name,
                section: row.section_name,
              });
              return (
                <TableRow key={`${row.exam_subject_id}|${row.section_id}`}>
                  <TableCell className="font-medium">{row.subject_name}</TableCell>
                  <TableCell>{section}</TableCell>
                  <TableCell className="tabular-nums">
                    {t("marks.progress.count", { done: row.entered, total: row.expected })}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {t("marks.progress.count", { done: row.submitted, total: row.expected })}
                  </TableCell>
                  <TableCell>
                    <ProgressBadge row={row} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        aria-label={t("marks.progress.enterRow", {
                          subject: row.subject_name,
                          section,
                        })}
                        onClick={() => {
                          onEnter(row);
                        }}
                      >
                        <PencilLine aria-hidden="true" />
                        {t("marks.progress.enter")}
                      </Button>
                      {canLock && <LockMarksButton row={row} />}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
