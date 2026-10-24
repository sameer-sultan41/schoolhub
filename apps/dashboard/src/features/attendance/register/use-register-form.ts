"use client";

import { useCallback, useMemo, useState } from "react";

import type {
  BulkMarkEntryInput,
  MarkableStatus,
  RegisterEntry,
  StudentAttendanceRecord,
} from "@/services";
import { toShortTime } from "@/services/modules/periods/periods-helper";
import { isMarkableStatus } from "@/services/modules/student-attendance/student-attendance-helper";

/** One student's choices on the register, as the inputs hold them. */
export interface RowDraft {
  status: MarkableStatus | "";
  checkInTime: string;
  checkOutTime: string;
  remarks: string;
}

/**
 * How the register treats a row: `leave` (approved leave, shown, never sent), `locked` (past the
 * lock window, changed only through a correction), `editable`, or `readOnly` (the whole date
 * can't be marked: `meta.markable` is false).
 */
export type RowMode = "editable" | "leave" | "locked" | "readOnly";

export interface RegisterRowState {
  entry: RegisterEntry;
  mode: RowMode;
  draft: RowDraft;
  /** The server's sentence for this student from a refused submission (`meta.rows`). */
  issue: string | null;
  /** Both times are set and the check-out isn't after the check-in, which the server refuses. */
  leavesBeforeArriving: boolean;
}

export interface RegisterCounts {
  present: number;
  absent: number;
  late: number;
  /** Half day, excused and on leave. */
  other: number;
  unmarked: number;
}

export function rowMode(entry: RegisterEntry, markable: boolean): RowMode {
  if (entry.on_leave || entry.record?.status === "on_leave") return "leave";
  if (entry.record?.is_locked) return "locked";
  return markable ? "editable" : "readOnly";
}

/** A row as its saved record has it, or blank when it was never marked. */
export function draftFromRecord(record: StudentAttendanceRecord | null): RowDraft {
  return {
    status: record && isMarkableStatus(record.status) ? record.status : "",
    checkInTime: record?.check_in_time ? toShortTime(record.check_in_time) : "",
    checkOutTime: record?.check_out_time ? toShortTime(record.check_out_time) : "",
    remarks: record?.remarks ?? "",
  };
}

/** The server's `BulkMarkEntrySerializer` rule: with both times set, check-out is after
 * check-in. `HH:MM` strings compare in time order. */
function leavesBeforeArriving(draft: RowDraft): boolean {
  return (
    draft.checkInTime !== "" && draft.checkOutTime !== "" && draft.checkOutTime <= draft.checkInTime
  );
}

/** The status a row counts under in the summary. */
function shownStatus(row: RegisterRowState): string {
  if (row.mode === "leave") return "on_leave";
  if (row.mode === "editable") return row.draft.status;
  return row.entry.record?.status ?? "";
}

function newKey(): string {
  return crypto.randomUUID();
}

/**
 * A register's grid: each student's choices over their saved record, the server's per-row
 * issues, and the submission's idempotency key.
 *
 * The key is made on load and remade on **every** change to the grid and after each success, so
 * a retry of an unchanged submission is answered with its replay while an edited one is never
 * answered with an older submission's (`apps/api/core/idempotency/services.py`). A refused
 * submission keeps it: nothing was stored under it.
 *
 * Edits are held per student over `entries`, so a reload (after a 409) keeps every choice on a
 * row that is still editable, and a row that became locked shows its record again.
 */
export function useRegisterForm(entries: RegisterEntry[], markable: boolean) {
  const [edits, setEdits] = useState<ReadonlyMap<string, RowDraft>>(() => new Map());
  const [issues, setIssues] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);

  const rows = useMemo<RegisterRowState[]>(
    () =>
      entries.map((entry) => {
        const mode = rowMode(entry, markable);
        const saved = draftFromRecord(entry.record);
        const draft = mode === "editable" ? (edits.get(entry.student_id) ?? saved) : saved;
        return {
          entry,
          mode,
          draft,
          issue: issues.get(entry.student_id) ?? null,
          leavesBeforeArriving: mode === "editable" && leavesBeforeArriving(draft),
        };
      }),
    [entries, markable, edits, issues],
  );

  const editable = useMemo(() => rows.filter((row) => row.mode === "editable"), [rows]);

  const editRow = useCallback(
    (studentId: string, patch: Partial<RowDraft>) => {
      const row = editable.find((candidate) => candidate.entry.student_id === studentId);
      if (!row) return;
      const saved = draftFromRecord(row.entry.record);
      setEdits((previous) =>
        new Map(previous).set(studentId, { ...(previous.get(studentId) ?? saved), ...patch }),
      );
      setIdempotencyKey(newKey());
    },
    [editable],
  );

  /** Every editable row with no status yet becomes present; leave and locked rows are skipped. */
  const markAllPresent = useCallback(() => {
    const unmarked = editable.filter((row) => row.draft.status === "");
    if (unmarked.length === 0) return;
    setEdits((previous) => {
      const next = new Map(previous);
      for (const row of unmarked) {
        const current = previous.get(row.entry.student_id) ?? row.draft;
        if (current.status !== "") continue;
        next.set(row.entry.student_id, { ...current, status: "present" });
      }
      return next;
    });
    setIdempotencyKey(newKey());
  }, [editable]);

  const counts = useMemo<RegisterCounts>(() => {
    const tally: RegisterCounts = { present: 0, absent: 0, late: 0, other: 0, unmarked: 0 };
    for (const row of rows) {
      const status = shownStatus(row);
      if (status === "present" || status === "absent" || status === "late") tally[status] += 1;
      else if (status === "") tally.unmarked += 1;
      else tally.other += 1;
    }
    return tally;
  }, [rows]);

  const unmarkedEditable = editable.filter((row) => row.draft.status === "").length;
  const timeErrors = editable.filter((row) => row.leavesBeforeArriving).length;
  const canSubmit = editable.length > 0 && unmarkedEditable === 0 && timeErrors === 0;

  /** The submission: every editable row (leave and locked rows are left out). */
  const buildEntries = useCallback(
    (): BulkMarkEntryInput[] =>
      editable.flatMap(({ entry, draft }) =>
        draft.status === ""
          ? []
          : [
              {
                studentId: entry.student_id,
                status: draft.status,
                checkInTime: draft.checkInTime || undefined,
                checkOutTime: draft.checkOutTime || undefined,
                remarks: draft.remarks.trim() || undefined,
              },
            ],
      ),
    [editable],
  );

  /** A submission was saved: the records now hold every choice. */
  const markSaved = useCallback(() => {
    setEdits(new Map());
    setIssues(new Map());
    setIdempotencyKey(newKey());
  }, []);

  return {
    rows,
    counts,
    editableCount: editable.length,
    unmarkedEditable,
    canSubmit,
    idempotencyKey,
    editRow,
    markAllPresent,
    buildEntries,
    setIssues,
    markSaved,
  };
}

export type RegisterForm = ReturnType<typeof useRegisterForm>;
