"use client";

import { useCallback, useMemo, useReducer, useState } from "react";

import type {
  MarksEntryInput,
  MarksEntryStatus,
  MarksGridEntry,
  MarksGridMeta,
  MarksRecord,
  RowIssue,
} from "@/services";
import { MARKS_STATUS_SUBMITTED } from "@/services/modules/marks/marks-constant";
import { markIssue, toMarkInput } from "@/services/modules/marks/marks-helper";

/** One student's row as the inputs hold it. */
export interface MarksDraft {
  theory: string;
  practical: string;
  isAbsent: boolean;
  isExempt: boolean;
  remarks: string;
}

export type MarkIssue = ReturnType<typeof markIssue>;

export interface MarksRowState {
  entry: MarksGridEntry;
  draft: MarksDraft;
  theoryIssue: MarkIssue;
  practicalIssue: MarkIssue;
  /** The server's refusal of this row from the last submission (`error.meta.rows`). */
  issue: RowIssue | null;
  /** No mark, not absent, not exempt. */
  isBlank: boolean;
}

/** A row as its saved marks have it, or blank when nothing was entered. */
export function draftFromMarks(marks: MarksRecord | null): MarksDraft {
  return {
    theory: toMarkInput(marks?.theory_marks ?? null),
    practical: toMarkInput(marks?.practical_marks ?? null),
    isAbsent: marks?.is_absent ?? false,
    isExempt: marks?.is_exempt ?? false,
    remarks: marks?.remarks ?? "",
  };
}

/** Absent and exempt exclude each other and any mark (`MarksEntrySerializer.validate`), so
 * ticking one clears the other and the marks. */
export function applyPatch(draft: MarksDraft, patch: Partial<MarksDraft>): MarksDraft {
  const next = { ...draft, ...patch };
  if (patch.isAbsent) return { ...next, isExempt: false, theory: "", practical: "" };
  if (patch.isExempt) return { ...next, isAbsent: false, theory: "", practical: "" };
  return next;
}

function isBlank(draft: MarksDraft): boolean {
  return !draft.isAbsent && !draft.isExempt && draft.theory === "" && draft.practical === "";
}

function newKey(): string {
  return crypto.randomUUID();
}

export interface MarksGridState {
  edits: ReadonlyMap<string, MarksDraft>;
  idempotencyKey: string;
}

/** A change to the grid, each carrying the key the grid is sent under once it applies. */
export type MarksGridAction = { key: string } & (
  | { type: "edit"; studentId: string; saved: MarksDraft; patch: Partial<MarksDraft> }
  /** A submission was stored: the saved marks now hold every edit. */
  | { type: "saved" }
);

export function initialMarksGrid(): MarksGridState {
  return { edits: new Map(), idempotencyKey: newKey() };
}

/**
 * Every edit and every success takes the action's fresh `key`, so an edited grid is never sent
 * under an older submission's key. Pure: the dispatchers make the key (React may replay a reducer).
 */
export function marksGridReducer(state: MarksGridState, action: MarksGridAction): MarksGridState {
  switch (action.type) {
    case "edit": {
      const current = state.edits.get(action.studentId) ?? action.saved;
      const edits = new Map(state.edits).set(action.studentId, applyPatch(current, action.patch));
      return { edits, idempotencyKey: action.key };
    }
    case "saved":
      return { edits: new Map(), idempotencyKey: action.key };
  }
}

/**
 * One section's marks grid: each student's row over their saved marks, the cells' own checks,
 * the server's per-row refusals, and the submission's idempotency key.
 *
 * The key is made on load and remade on every edit and after each success, so a re-send of an
 * unchanged grid replays its answer while an edited one is never answered with an older one's. A
 * refusal keeps it (`setIssues` is not an edit, and nothing was stored), and keeps every edit.
 */
export function useMarksGridForm(entries: MarksGridEntry[], meta: MarksGridMeta) {
  const [{ edits, idempotencyKey }, dispatch] = useReducer(
    marksGridReducer,
    undefined,
    initialMarksGrid,
  );
  const [issues, setIssues] = useState<ReadonlyMap<string, RowIssue>>(() => new Map());
  const { writable } = meta;
  const { maxMarks, hasPractical, practicalMaxMarks } = meta.examSubject;

  const rows = useMemo<MarksRowState[]>(
    () =>
      entries.map((entry) => {
        const saved = draftFromMarks(entry.marks);
        // A read-only grid shows only what the server holds, never an unsaved edit (after a 409).
        const draft = writable ? (edits.get(entry.student_id) ?? saved) : saved;
        return {
          entry,
          draft,
          theoryIssue: markIssue(draft.theory, maxMarks),
          practicalIssue: hasPractical ? markIssue(draft.practical, practicalMaxMarks) : null,
          issue: issues.get(entry.student_id) ?? null,
          isBlank: isBlank(draft),
        };
      }),
    [entries, edits, issues, writable, maxMarks, hasPractical, practicalMaxMarks],
  );

  const editRow = useCallback(
    (studentId: string, patch: Partial<MarksDraft>) => {
      const entry = entries.find((candidate) => candidate.student_id === studentId);
      if (!entry) return;
      dispatch({
        type: "edit",
        key: newKey(),
        studentId,
        saved: draftFromMarks(entry.marks),
        patch,
      });
    },
    [entries],
  );

  const invalidCount = rows.filter(
    (row) => row.theoryIssue === "invalid" || row.practicalIssue === "invalid",
  ).length;
  const blankCount = rows.filter((row) => row.isBlank).length;
  // A draft sends the rows that hold something, or that held something before (to clear it).
  const draftRows = useMemo(
    () => rows.filter((row) => !row.isBlank || row.entry.marks !== null),
    [rows],
  );
  const canSaveDraft = writable && invalidCount === 0 && draftRows.length > 0;
  const canSubmit = writable && invalidCount === 0 && blankCount === 0 && rows.length > 0;

  /** The submission: every row a draft keeps, or every row, all under `status`. */
  const buildEntries = useCallback(
    (status: MarksEntryStatus): MarksEntryInput[] =>
      (status === MARKS_STATUS_SUBMITTED ? rows : draftRows).map(({ entry, draft }) => ({
        studentId: entry.student_id,
        theoryMarks: draft.theory || null,
        practicalMarks: hasPractical ? draft.practical || null : null,
        isAbsent: draft.isAbsent,
        isExempt: draft.isExempt,
        status,
        remarks: draft.remarks.trim() || null,
      })),
    [rows, draftRows, hasPractical],
  );

  const markSaved = useCallback(() => {
    dispatch({ type: "saved", key: newKey() });
    setIssues(new Map());
  }, []);

  return {
    rows,
    blankCount,
    invalidCount,
    canSaveDraft,
    canSubmit,
    idempotencyKey,
    editRow,
    buildEntries,
    setIssues,
    markSaved,
  };
}

export type MarksGridForm = ReturnType<typeof useMarksGridForm>;
