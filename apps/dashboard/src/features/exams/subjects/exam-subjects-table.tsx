"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardHeading,
  CardTitle,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@schoolhub/ui";
import { BookOpen, Lock, LockOpen, Plus } from "lucide-react";

import { LoadErrorCard } from "@/components/load-error-card";
import { RowEditRemoveActions } from "@/components/row-edit-remove-actions";
import { useCurrentUser } from "@/hooks/use-current-user";
import { EMPTY_VALUE } from "@/lib/constants";
import { resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import type { ExamRecord, ExamSubjectRecord } from "@/services";
import {
  formatDateTime,
  groupByClass,
} from "@/services/modules/exam-subjects/exam-subjects-helper";
import { isExamConfigurable } from "@/services/modules/exams/exams-helper";
import { useExamSubjects } from "@/features/exams/use-exam-subjects";
import { DeleteExamSubjectDialog } from "./delete-exam-subject-dialog";
import { ExamSubjectFormDialog } from "./exam-subject-form-dialog";

const COLUMN_KEYS = [
  "subject",
  "maxMarks",
  "passMarks",
  "practical",
  "weightage",
  "entryWindow",
  "locked",
] as const;

/** A subject's marks entry window as text: both ends, one end, or not set. */
function EntryWindow({ row }: { row: ExamSubjectRecord }) {
  const t = useTranslations("exams");
  const locale = useLocale();
  const { marks_entry_opens_at: opens, marks_entry_closes_at: closes } = row;

  if (opens && closes) {
    return t("subjects.window", {
      from: formatDateTime(opens, locale),
      to: formatDateTime(closes, locale),
    });
  }
  if (opens) return t("subjects.windowFrom", { from: formatDateTime(opens, locale) });
  if (closes) return t("subjects.windowUntil", { to: formatDateTime(closes, locale) });
  return t("subjects.windowNotSet");
}

/**
 * The exam's Subjects tab: every subject of the exam, grouped by class (class, subject, max and
 * pass marks, practical split, weightage, marks entry window, locked), read in full through
 * `useExamSubjects`. Add, edit and remove need `exams.exam.update` and an
 * exam still up to `scheduled`; past that the tab is read-only, since the exam's configuration is
 * frozen. Each dialog is mounted only while open.
 */
export function ExamSubjectsTable({ exam }: { exam: ExamRecord }) {
  const t = useTranslations("exams");
  const tErrors = useTranslations("errors");

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ExamSubjectRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExamSubjectRecord | null>(null);

  const { data: user } = useCurrentUser();
  const canWrite = hasPermission(user, "exams.exam.update") && isExamConfigurable(exam.status);

  const query = useExamSubjects(exam.id);

  if (query.isError) {
    return (
      <LoadErrorCard
        message={resolveErrorMessage(query.error, tErrors, t("subjects.loadError"))}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  if (query.isPending) {
    return (
      <div role="status" className="space-y-3">
        <span className="sr-only">{t("subjects.title")}</span>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const groups = groupByClass(query.data);

  return (
    <div className="space-y-5">
      {canWrite && (
        <div className="flex justify-end">
          <Button
            variant="primary"
            onClick={() => {
              setAddOpen(true);
            }}
          >
            <Plus aria-hidden="true" />
            {t("subjects.actions.add")}
          </Button>
        </div>
      )}
      {groups.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={t("subjects.emptyTitle")}
          description={t(canWrite ? "subjects.emptyDescription" : "subjects.emptyFrozen")}
        />
      ) : (
        groups.map((group) => (
          <Card key={group.classId}>
            <CardHeader>
              <CardHeading>
                <CardTitle>{group.className}</CardTitle>
              </CardHeading>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    {COLUMN_KEYS.map((key) => (
                      <TableHead key={key}>{t(`subjects.columns.${key}`)}</TableHead>
                    ))}
                    {canWrite && <TableHead className="w-0" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.subject_name}</TableCell>
                      <TableCell>{row.max_marks}</TableCell>
                      <TableCell>{row.pass_marks}</TableCell>
                      <TableCell>
                        {row.has_practical && row.practical_max_marks
                          ? t("subjects.practicalSplit", {
                              max: row.practical_max_marks,
                              pass: row.practical_pass_marks ?? EMPTY_VALUE,
                            })
                          : t("subjects.noPractical")}
                      </TableCell>
                      <TableCell>
                        {row.subject_weightage_percent
                          ? t("subjects.weightagePercent", {
                              percent: row.subject_weightage_percent,
                            })
                          : EMPTY_VALUE}
                      </TableCell>
                      <TableCell>
                        <EntryWindow row={row} />
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5">
                          {row.marks_locked_at ? (
                            <Lock className="size-3.5" aria-hidden="true" />
                          ) : (
                            <LockOpen className="size-3.5" aria-hidden="true" />
                          )}
                          {t(row.marks_locked_at ? "subjects.lockedYes" : "subjects.lockedNo")}
                        </span>
                      </TableCell>
                      {canWrite && (
                        <TableCell>
                          <RowEditRemoveActions
                            editLabel={t("subjects.actions.editRow", {
                              subject: row.subject_name,
                              class: row.class_name,
                            })}
                            onEdit={() => {
                              setEditTarget(row);
                            }}
                            removeLabel={t("subjects.actions.deleteRow", {
                              subject: row.subject_name,
                              class: row.class_name,
                            })}
                            onRemove={() => {
                              setDeleteTarget(row);
                            }}
                          />
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))
      )}
      {addOpen && <ExamSubjectFormDialog open onOpenChange={setAddOpen} exam={exam} />}
      {editTarget && (
        <ExamSubjectFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
          exam={exam}
          record={editTarget}
        />
      )}
      {deleteTarget && (
        <DeleteExamSubjectDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          record={deleteTarget}
        />
      )}
    </div>
  );
}
