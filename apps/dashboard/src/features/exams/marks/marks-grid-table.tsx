"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Alert,
  Button,
  EmptyState,
  Table,
  TableBody,
  TableCaption,
  TableHead,
  TableHeader,
  TableRow,
} from "@schoolhub/ui";
import { Save, Send, Users } from "lucide-react";

import { HTTP_STATUS_CONFLICT } from "@/lib/constants";
import { foldUnknownFieldErrors, NON_FIELD, resolveErrorMessage } from "@/lib/error-message";
import {
  ApiError,
  Services,
  type BulkMarksEntryInput,
  type MarksEntryStatus,
  type MarksGrid,
} from "@/services";
import {
  MARKS_STATUS_DRAFT,
  MARKS_STATUS_SUBMITTED,
} from "@/services/modules/marks/marks-constant";
import { toMarkInput } from "@/services/modules/marks/marks-helper";
import { rowIssueRecordsFromError } from "@/services/shared/row-issues";
import { MarksGridRow } from "./marks-grid-row";
import { marksSaveKeys } from "./marks-query-keys";
import { useMarksGridForm } from "./use-marks-grid-form";

const BLANK_NOTE_ID = "marks-grid-blank";

interface SaveVariables {
  input: BulkMarksEntryInput;
  key: string;
  status: MarksEntryStatus;
}

export interface MarksGridTableProps {
  grid: MarksGrid;
  examId: string;
  examSubjectId: string;
  sectionId: string;
  /** The grid's name (subject, class and section), for its caption. */
  heading: string;
}

/**
 * One section's marks for one exam-subject, saved whole: Save draft and Submit send the rows as
 * `draft` or `submitted`, with the section. A refusal (`422`, `error.meta.rows`) marks the rows it
 * names and keeps every entry; a `409` (the window closed, the subject was locked) reloads the
 * grid, which then shows read-only with the server's reason. The caller keys this by subject and
 * section, so another grid starts with fresh edits and a fresh idempotency key.
 */
export function MarksGridTable({
  grid,
  examId,
  examSubjectId,
  sectionId,
  heading,
}: MarksGridTableProps) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  // Only what a save changes: this grid, the exam's progress and the exam itself.
  const refreshAfterSave = () =>
    Promise.all(
      marksSaveKeys(examId, { examSubjectId, sectionId }).map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
  const { entries, meta } = grid;
  const { hasPractical } = meta.examSubject;
  // As the inputs show a mark: "100", not "100.00".
  const maxMarks = toMarkInput(meta.examSubject.maxMarks);
  const practicalMaxMarks = meta.examSubject.practicalMaxMarks
    ? toMarkInput(meta.examSubject.practicalMaxMarks)
    : null;
  const form = useMarksGridForm(entries, meta);
  const [notice, setNotice] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: ({ input, key }: SaveVariables) => Services.marks.bulkEntry(input, key),
    onSuccess: async (counts, { status }) => {
      // The edits are dropped only once the grid holds what was saved, so no row flashes its old
      // value; the buttons stay held until then.
      await refreshAfterSave();
      form.markSaved();
      toast.success(
        t(status === MARKS_STATUS_SUBMITTED ? "marks.grid.submitted" : "marks.grid.saved", {
          entered: counts.entered,
          updated: counts.updated,
        }),
      );
    },
    onError: (error) => {
      // The rows the server refused, each with its sentence and cell; every entry stays.
      form.setIssues(rowIssueRecordsFromError(error));
      setNotice(
        resolveErrorMessage(
          foldUnknownFieldErrors(error),
          tErrors,
          tCommon("submitFailed"),
          NON_FIELD,
        ),
      );
      // The grid stopped taking marks while it was open: reload it to show why.
      if (error instanceof ApiError && error.status === HTTP_STATUS_CONFLICT) {
        void refreshAfterSave();
      }
    },
  });

  function send(status: MarksEntryStatus) {
    if (save.isPending) return;
    setNotice(null);
    form.setIssues(new Map());
    save.mutate({
      status,
      key: form.idempotencyKey,
      input: { examSubjectId, sectionId, entries: form.buildEntries(status) },
    });
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title={t("marks.grid.emptyTitle")}
        description={t("marks.grid.emptyDescription")}
      />
    );
  }

  const readOnly = !meta.writable;
  const columns = [
    "roll",
    "student",
    "admissionNumber",
    "theory",
    ...(hasPractical ? ["practical"] : []),
    "absent",
    "exempt",
    "remarks",
  ];

  return (
    <div className="space-y-4">
      {notice && <Alert variant="destructive">{notice}</Alert>}
      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableCaption className="sr-only">{t("marks.grid.caption", { heading })}</TableCaption>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column}>
                  {column === "theory" || column === "practical"
                    ? t(`marks.grid.columns.${column}`, {
                        max: column === "theory" ? maxMarks : (practicalMaxMarks ?? ""),
                      })
                    : t(`marks.grid.columns.${column}`)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {form.rows.map((row) => (
              <MarksGridRow
                key={row.entry.student_id}
                row={row}
                hasPractical={hasPractical}
                maxMarks={maxMarks}
                practicalMaxMarks={practicalMaxMarks}
                readOnly={readOnly}
                disabled={save.isPending}
                onEdit={form.editRow}
              />
            ))}
          </TableBody>
        </Table>
      </div>
      {!readOnly && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {form.blankCount > 0 && (
            <span id={BLANK_NOTE_ID} className="text-sm text-muted-foreground">
              {t("marks.grid.blankCount", { count: form.blankCount })}
            </span>
          )}
          <Button
            variant="outline"
            disabled={!form.canSaveDraft || save.isPending}
            onClick={() => {
              send(MARKS_STATUS_DRAFT);
            }}
          >
            <Save aria-hidden="true" />
            {t("marks.grid.saveDraft")}
          </Button>
          <Button
            variant="primary"
            disabled={!form.canSubmit || save.isPending}
            aria-describedby={form.blankCount > 0 ? BLANK_NOTE_ID : undefined}
            onClick={() => {
              send(MARKS_STATUS_SUBMITTED);
            }}
          >
            <Send aria-hidden="true" />
            {t("marks.grid.submit")}
          </Button>
        </div>
      )}
    </div>
  );
}
