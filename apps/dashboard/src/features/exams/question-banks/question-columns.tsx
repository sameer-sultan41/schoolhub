"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, Button, Skeleton } from "@schoolhub/ui";
import { CircleCheck, Hourglass, ShieldCheck } from "lucide-react";

import { RowEditRemoveActions } from "@/components/row-edit-remove-actions";
import { EMPTY_VALUE } from "@/lib/constants";
import type { QuestionRecord } from "@/services";
import {
  AI_GENERATED_SOURCE,
  DEFAULT_DIFFICULTY,
  DEFAULT_QUESTION_SOURCE,
  QUESTIONS_ACTIONS_COLUMN_ID,
} from "@/services/modules/question-banks/question-banks-constant";
import { isAwaitingApproval } from "@/services/modules/question-banks/question-banks-helper";
import { AiGeneratedBadge } from "./ai-generated-badge";

export interface QuestionRowActions {
  canUpdate: boolean;
  canDelete: boolean;
  canApprove: boolean;
  onEdit: (question: QuestionRecord) => void;
  onRemove: (question: QuestionRecord) => void;
  /** Opens the approval confirm, which shows the whole question before anything is sent. */
  onApprove: (question: QuestionRecord) => void;
}

/** A question's approval as token, icon and label together: an AI draft waits for a person
 * (§7.2); once approved, an AI question keeps who approved it (ai-governance.md §8). */
function ApprovalCell({ question }: { question: QuestionRecord }) {
  const t = useTranslations("exams");
  if (isAwaitingApproval(question)) {
    return (
      <Badge variant="warning" appearance="light">
        <Hourglass aria-hidden="true" />
        {t("questionBanks.questions.awaitingApproval")}
      </Badge>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge variant="success" appearance="light">
        <CircleCheck aria-hidden="true" />
        {t("questionBanks.questions.approved")}
      </Badge>
      {question.approved_by_name && (
        <span className="text-xs text-muted-foreground">
          {t("questionBanks.questions.approvedBy", { name: question.approved_by_name })}
        </span>
      )}
    </div>
  );
}

/**
 * A bank's question columns; none sorts (the list is in the bank's own order). Approve shows only
 * on an AI draft nobody has approved, to a holder of `exams.question.approve`: a teacher's own
 * question needs no approval, and the server refuses one. Memoized on its inputs, so the caller
 * passes `useCallback`-stable handlers.
 */
export function useQuestionColumns(actions: QuestionRowActions): ColumnDef<QuestionRecord>[] {
  const t = useTranslations("exams");
  const { canUpdate, canDelete, canApprove, onEdit, onRemove, onApprove } = actions;

  return useMemo<ColumnDef<QuestionRecord>[]>(
    () => [
      {
        id: "question",
        enableSorting: false,
        enableHiding: false,
        header: () => t("questionBanks.questions.columns.question"),
        cell: ({ row }) => (
          <span className="line-clamp-2 max-w-md">{row.original.question_text}</span>
        ),
        meta: { skeleton: <Skeleton className="h-4 w-64" /> },
      },
      {
        id: "type",
        enableSorting: false,
        header: () => t("questionBanks.questions.columns.type"),
        cell: ({ row }) => t(`questionBanks.types.${row.original.question_type}`),
        meta: {
          headerTitle: t("questionBanks.questions.columns.type"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "difficulty",
        enableSorting: false,
        header: () => t("questionBanks.questions.columns.difficulty"),
        cell: ({ row }) =>
          t(`questionBanks.difficulty.${row.original.difficulty ?? DEFAULT_DIFFICULTY}`),
        meta: {
          headerTitle: t("questionBanks.questions.columns.difficulty"),
          skeleton: <Skeleton className="h-4 w-16" />,
        },
      },
      {
        id: "topic",
        enableSorting: false,
        header: () => t("questionBanks.questions.columns.topic"),
        cell: ({ row }) => row.original.topic ?? EMPTY_VALUE,
        meta: {
          headerTitle: t("questionBanks.questions.columns.topic"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "marks",
        enableSorting: false,
        header: () => t("questionBanks.questions.columns.marks"),
        cell: ({ row }) => row.original.default_marks ?? EMPTY_VALUE,
        meta: {
          headerTitle: t("questionBanks.questions.columns.marks"),
          skeleton: <Skeleton className="h-4 w-10" />,
        },
      },
      {
        id: "source",
        enableSorting: false,
        header: () => t("questionBanks.questions.columns.source"),
        cell: ({ row }) =>
          row.original.source === AI_GENERATED_SOURCE ? (
            <AiGeneratedBadge />
          ) : (
            t(`questionBanks.sources.${row.original.source ?? DEFAULT_QUESTION_SOURCE}`)
          ),
        meta: {
          headerTitle: t("questionBanks.questions.columns.source"),
          skeleton: <Skeleton className="h-5 w-24 rounded-full" />,
        },
      },
      {
        id: "approval",
        enableSorting: false,
        header: () => t("questionBanks.questions.columns.approval"),
        cell: ({ row }) => <ApprovalCell question={row.original} />,
        meta: {
          headerTitle: t("questionBanks.questions.columns.approval"),
          skeleton: <Skeleton className="h-5 w-24 rounded-full" />,
        },
      },
      {
        id: "used",
        enableSorting: false,
        header: () => t("questionBanks.questions.columns.used"),
        cell: ({ row }) => row.original.usage_count.toLocaleString(),
        meta: {
          headerTitle: t("questionBanks.questions.columns.used"),
          skeleton: <Skeleton className="h-4 w-8" />,
        },
      },
      {
        id: QUESTIONS_ACTIONS_COLUMN_ID,
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const question = row.original;
          const label = question.question_text;
          return (
            <div className="flex items-center gap-1">
              {canApprove && isAwaitingApproval(question) && (
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={t("questionBanks.questions.actions.approveRow", { question: label })}
                  onClick={() => {
                    onApprove(question);
                  }}
                >
                  <ShieldCheck aria-hidden="true" />
                  {t("questionBanks.questions.actions.approve")}
                </Button>
              )}
              <RowEditRemoveActions
                editLabel={
                  canUpdate
                    ? t("questionBanks.questions.actions.editRow", { question: label })
                    : undefined
                }
                onEdit={() => {
                  onEdit(question);
                }}
                removeLabel={
                  canDelete
                    ? t("questionBanks.questions.actions.deleteRow", { question: label })
                    : undefined
                }
                onRemove={() => {
                  onRemove(question);
                }}
              />
            </div>
          );
        },
        meta: { skeleton: <Skeleton className="h-7 w-24" /> },
      },
    ],
    [t, canUpdate, canDelete, canApprove, onEdit, onRemove, onApprove],
  );
}
