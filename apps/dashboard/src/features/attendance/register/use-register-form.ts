"use client";

import { useCallback, useMemo, useReducer, useState } from "react";

import type {
  AttendanceStatus,
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

/** The rows under each status, and those with none. Keyed by the generated enum, so a new
 * status fails to compile until the tally counts it. */
export type RegisterCounts = Record<AttendanceStatus, number> & { unmarked: number };

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

/** The status a row counts under in the summary, or `""` while it has none. */
function shownStatus(row: RegisterRowState): AttendanceStatus | "" {
  if (row.mode === "leave") return "on_leave";
  if (row.mode === "editable") return row.draft.status;
  return row.entry.record?.status ?? "";
}

/** Every count at zero. A status missing here is a compile error, never a row counted nowhere. */
const NO_COUNTS: RegisterCounts = {
  present: 0,
  absent: 0,
  late: 0,
  half_day: 0,
  excused: 0,
  on_leave: 0,
  unmarked: 0,
};

/** Each row counted under the status it shows. */
function tallyRows(rows: readonly RegisterRowState[]): RegisterCounts {
  const tally = { ...NO_COUNTS };
  for (const row of rows) {
    const status = shownStatus(row);
    tally[status === "" ? "unmarked" : status] += 1;
  }
  return tally;
}

function newKey(): string {
  return crypto.randomUUID();
}

/** The grid's edits over the saved records, and the key the next submission is sent under. */
export interface RegisterGridState {
  edits: ReadonlyMap<string, RowDraft>;
  idempotencyKey: string;
}

/** A change to the grid, each carrying the key the grid is sent under once it applies. */
export type RegisterGridAction = { key: string } &
  /** One row's choices change; `saved` is its record's draft, the base of a first edit. */
  (
    | { type: "edit"; studentId: string; saved: RowDraft; patch: Partial<RowDraft> }
    /** Each listed row with no status yet becomes present. */
    | { type: "markAllPresent"; rows: readonly { studentId: string; draft: RowDraft }[] }
    /** A submission was stored: the records now hold every choice. */
    | { type: "saved" }
  );

/** The grid on load: no edits, and a key made once by `useReducer`'s initialiser. */
export function initialRegisterGrid(): RegisterGridState {
  return { edits: new Map(), idempotencyKey: newKey() };
}

/**
 * Every action that changes the grid, and `saved`, takes the action's `key`, so no edit path can
 * keep an old one: an edited grid is never sent under an older submission's key.
 *
 * Pure: the hook's dispatchers make the key and pass it in. React may run a reducer more than
 * once for one update (StrictMode, and replaying updates it skipped during a render), and each
 * run must give the same state, key included, as the one already rendered.
 */
export function registerGridReducer(
  state: RegisterGridState,
  action: RegisterGridAction,
): RegisterGridState {
  switch (action.type) {
    case "edit": {
      const current = state.edits.get(action.studentId) ?? action.saved;
      const edits = new Map(state.edits).set(action.studentId, { ...current, ...action.patch });
      return { edits, idempotencyKey: action.key };
    }
    case "markAllPresent": {
      const edits = new Map(state.edits);
      let changed = false;
      for (const row of action.rows) {
        const current = state.edits.get(row.studentId) ?? row.draft;
        if (current.status !== "") continue;
        edits.set(row.studentId, { ...current, status: "present" });
        changed = true;
      }
      // Nothing was left unmarked: the grid, and so the key, stay as they were.
      return changed ? { edits, idempotencyKey: action.key } : state;
    }
    case "saved":
      return { edits: new Map(), idempotencyKey: action.key };
  }
}

/**
 * A register's grid: each student's choices over their saved record, the server's per-row
 * issues, and the submission's idempotency key.
 *
 * The key is made on load and remade on **every** change to the grid and after each success
 * (the dispatchers below make it; `registerGridReducer` stores it), so a retry of an unchanged
 * submission is answered with its replay while an edited one is never answered with an older
 * submission's (`apps/api/core/idempotency/services.py`). A refused submission or a dropped
 * request keeps it: `setIssues` is not a grid change, and nothing was stored under the key.
 *
 * Edits are held per student over `entries`, so a reload (after a 409) keeps every choice on a
 * row that is still editable, and a row that became locked shows its record again.
 */
export function useRegisterForm(entries: RegisterEntry[], markable: boolean) {
  const [{ edits, idempotencyKey }, dispatch] = useReducer(
    registerGridReducer,
    undefined,
    initialRegisterGrid,
  );
  const [issues, setIssues] = useState<ReadonlyMap<string, string>>(() => new Map());

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
      dispatch({
        type: "edit",
        key: newKey(),
        studentId,
        saved: draftFromRecord(row.entry.record),
        patch,
      });
    },
    [editable],
  );

  /** Every editable row with no status yet becomes present; leave and locked rows are skipped. */
  const markAllPresent = useCallback(() => {
    const unmarked = editable.filter((row) => row.draft.status === "");
    if (unmarked.length === 0) return;
    dispatch({
      type: "markAllPresent",
      key: newKey(),
      rows: unmarked.map((row) => ({ studentId: row.entry.student_id, draft: row.draft })),
    });
  }, [editable]);

  const counts = useMemo(() => tallyRows(rows), [rows]);

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
    dispatch({ type: "saved", key: newKey() });
    setIssues(new Map());
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
