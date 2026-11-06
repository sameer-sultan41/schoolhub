"use client";

import { useTranslations } from "next-intl";
import { Checkbox, cn, Input, TableCell, TableRow } from "@schoolhub/ui";

import { EMPTY_VALUE } from "@/lib/constants";
import { MARKS_REMARKS_MAX_LENGTH } from "@/services/modules/marks/marks-constant";
import type { MarkIssue, MarksDraft, MarksRowState } from "./use-marks-grid-form";

export interface MarksGridRowProps {
  row: MarksRowState;
  hasPractical: boolean;
  maxMarks: string;
  practicalMaxMarks: string | null;
  /** The grid is not writable: values show as text. */
  readOnly: boolean;
  /** A submission is in flight: an edit then would be lost when it lands. */
  disabled: boolean;
  onEdit: (studentId: string, patch: Partial<MarksDraft>) => void;
}

interface MarkCellProps {
  id: string;
  label: string;
  value: string;
  max: string;
  /** This cell's own check. */
  check: MarkIssue;
  /** The server refused this row on this cell. */
  refused: boolean;
  describedBy: string | undefined;
  disabled: boolean;
  onChange: (value: string) => void;
}

/** One mark input, with its hint when the value is not a mark or is above the maximum. */
function MarkCell({
  id,
  label,
  value,
  max,
  check,
  refused,
  describedBy,
  disabled,
  onChange,
}: MarkCellProps) {
  const t = useTranslations("exams");
  const hintId = `${id}-hint`;
  const described = [check ? hintId : null, describedBy].filter(Boolean).join(" ") || undefined;
  return (
    <TableCell className="align-top">
      <Input
        id={id}
        inputMode="decimal"
        className="w-24"
        aria-label={label}
        aria-invalid={check !== null || refused}
        aria-describedby={described}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value.trim());
        }}
      />
      {check && (
        <p id={hintId} className="mt-1 text-xs text-danger">
          {check === "aboveMax" ? t("marks.grid.aboveMax", { max }) : t("marks.grid.invalid")}
        </p>
      )}
    </TableCell>
  );
}

/** A mark as text: absent, exempt, the value, or blank. */
function ReadOnlyMark({ draft, value }: { draft: MarksDraft; value: string }) {
  const t = useTranslations("exams");
  if (draft.isAbsent) return t("marks.grid.absentValue");
  if (draft.isExempt) return t("marks.grid.exemptValue");
  return value || EMPTY_VALUE;
}

/**
 * One student: roll, name and admission number, then theory, practical (when the subject has
 * one), absent, exempt and remarks. Absent and exempt clear and disable the marks. A row the
 * server refused shows its sentence and marks the cell it named.
 */
export function MarksGridRow({
  row,
  hasPractical,
  maxMarks,
  practicalMaxMarks,
  readOnly,
  disabled,
  onEdit,
}: MarksGridRowProps) {
  const t = useTranslations("exams");
  const { entry, draft, issue } = row;
  const id = entry.student_id;
  const name = entry.student_name;
  const issueId = `marks-issue-${id}`;
  const describedBy = issue ? issueId : undefined;
  const marksDisabled = disabled || draft.isAbsent || draft.isExempt;
  const edit = (patch: Partial<MarksDraft>) => {
    onEdit(id, patch);
  };

  return (
    <TableRow className={cn(issue && "bg-destructive/5")}>
      <TableCell className="align-top tabular-nums">{entry.roll_number ?? EMPTY_VALUE}</TableCell>
      <TableCell className="align-top">
        <p className="font-medium">{name}</p>
        {issue && (
          <p id={issueId} className="mt-1 text-xs text-danger">
            {issue.issue}
          </p>
        )}
      </TableCell>
      <TableCell className="align-top">{entry.admission_number}</TableCell>
      {readOnly ? (
        <>
          <TableCell>
            <ReadOnlyMark draft={draft} value={draft.theory} />
          </TableCell>
          {hasPractical && (
            <TableCell>
              <ReadOnlyMark draft={draft} value={draft.practical} />
            </TableCell>
          )}
          <TableCell>{t(draft.isAbsent ? "marks.grid.yes" : "marks.grid.no")}</TableCell>
          <TableCell>{t(draft.isExempt ? "marks.grid.yes" : "marks.grid.no")}</TableCell>
          <TableCell>{draft.remarks || EMPTY_VALUE}</TableCell>
        </>
      ) : (
        <>
          <MarkCell
            id={`marks-theory-${id}`}
            label={t("marks.grid.theoryFor", { name })}
            value={draft.theory}
            max={maxMarks}
            check={row.theoryIssue}
            refused={issue?.field === "theory_marks"}
            describedBy={describedBy}
            disabled={marksDisabled}
            onChange={(value) => {
              edit({ theory: value });
            }}
          />
          {hasPractical && (
            <MarkCell
              id={`marks-practical-${id}`}
              label={t("marks.grid.practicalFor", { name })}
              value={draft.practical}
              max={practicalMaxMarks ?? EMPTY_VALUE}
              check={row.practicalIssue}
              refused={issue?.field === "practical_marks"}
              describedBy={describedBy}
              disabled={marksDisabled}
              onChange={(value) => {
                edit({ practical: value });
              }}
            />
          )}
          <TableCell className="align-top">
            <Checkbox
              aria-label={t("marks.grid.absentFor", { name })}
              aria-invalid={issue?.field === "is_absent"}
              checked={draft.isAbsent}
              disabled={disabled}
              onCheckedChange={(checked) => {
                edit({ isAbsent: checked === true });
              }}
            />
          </TableCell>
          <TableCell className="align-top">
            <Checkbox
              aria-label={t("marks.grid.exemptFor", { name })}
              aria-invalid={issue?.field === "is_exempt"}
              checked={draft.isExempt}
              disabled={disabled}
              onCheckedChange={(checked) => {
                edit({ isExempt: checked === true });
              }}
            />
          </TableCell>
          <TableCell className="align-top">
            <Input
              className="min-w-40"
              aria-label={t("marks.grid.remarksFor", { name })}
              aria-invalid={issue?.field === "remarks"}
              maxLength={MARKS_REMARKS_MAX_LENGTH}
              value={draft.remarks}
              disabled={disabled}
              onChange={(event) => {
                edit({ remarks: event.target.value });
              }}
            />
          </TableCell>
        </>
      )}
    </TableRow>
  );
}
