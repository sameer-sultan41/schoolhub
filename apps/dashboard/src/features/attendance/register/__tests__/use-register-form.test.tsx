import { act, renderHook } from "@testing-library/react";

import type { RegisterEntry } from "@/services";
import {
  attendanceRecord,
  OTHER_STUDENT_ID,
  registerEntry,
  STUDENT_ID,
  THIRD_STUDENT_ID,
} from "@/services/modules/student-attendance/__tests__/student-attendance-fixtures";

import { registerGridReducer, rowMode, useRegisterForm, type RowDraft } from "../use-register-form";

const FOURTH_STUDENT_ID = "22222222-aaaa-4bbb-8ccc-000000000004";

/** Amna unmarked, Bilal on leave, Sara locked absent, Omar marked late (unlocked). */
function roster(): RegisterEntry[] {
  return [
    registerEntry(),
    registerEntry({ student_id: OTHER_STUDENT_ID, student_name: "Bilal Khan", on_leave: true }),
    registerEntry({
      student_id: THIRD_STUDENT_ID,
      student_name: "Sara Ali",
      record: attendanceRecord({
        student_id: THIRD_STUDENT_ID,
        status: "absent",
        is_locked: true,
      }),
    }),
    registerEntry({
      student_id: FOURTH_STUDENT_ID,
      student_name: "Omar Shah",
      record: attendanceRecord({
        student_id: FOURTH_STUDENT_ID,
        status: "late",
        check_in_time: "08:20:00",
      }),
    }),
  ];
}

function renderForm(entries = roster(), markable = true) {
  return renderHook(({ rows, canMark }) => useRegisterForm(rows, canMark), {
    initialProps: { rows: entries, canMark: markable },
  });
}

describe("rowMode", () => {
  it("puts leave first, then the row's lock, then whether the date can be marked", () => {
    const leaveAndLocked = registerEntry({
      on_leave: true,
      record: attendanceRecord({ status: "on_leave", is_locked: true }),
    });
    expect(rowMode(leaveAndLocked, true)).toBe("leave");
    // A daily on_leave row is leave even where the entry's flag is not set.
    const leaveRecord = registerEntry({ record: attendanceRecord({ status: "on_leave" }) });
    expect(rowMode(leaveRecord, true)).toBe("leave");
    const locked = registerEntry({ record: attendanceRecord({ is_locked: true }) });
    expect(rowMode(locked, true)).toBe("locked");
    expect(rowMode(registerEntry(), true)).toBe("editable");
    expect(rowMode(registerEntry(), false)).toBe("readOnly");
  });
});

describe("useRegisterForm", () => {
  it("starts each row from its record, times as HH:MM", () => {
    const { result } = renderForm();

    const omar = result.current.rows.find((row) => row.entry.student_id === FOURTH_STUDENT_ID);
    expect(omar?.draft).toEqual({
      status: "late",
      checkInTime: "08:20",
      checkOutTime: "",
      remarks: "",
    });
    // Every status is counted under its own name: Bilal's leave is `on_leave`, not "other".
    expect(result.current.counts).toEqual({
      present: 0,
      absent: 1,
      late: 1,
      half_day: 0,
      excused: 0,
      on_leave: 1,
      unmarked: 1,
    });
  });

  it("counts a status as it is chosen, and a cleared one as unmarked again", () => {
    const { result } = renderForm();

    act(() => {
      result.current.editRow(STUDENT_ID, { status: "excused" });
    });
    expect(result.current.counts.excused).toBe(1);
    expect(result.current.counts.unmarked).toBe(0);

    act(() => {
      result.current.editRow(STUDENT_ID, { status: "" });
    });
    expect(result.current.counts.excused).toBe(0);
    expect(result.current.counts.unmarked).toBe(1);
  });

  it("makes an idempotency key on load and a new one on every edit", () => {
    const { result } = renderForm();
    const onLoad = result.current.idempotencyKey;
    expect(onLoad).toMatch(/^[0-9a-f-]{36}$/);

    act(() => {
      result.current.editRow(STUDENT_ID, { status: "absent" });
    });
    const afterStatus = result.current.idempotencyKey;
    expect(afterStatus).not.toBe(onLoad);

    act(() => {
      result.current.editRow(STUDENT_ID, { remarks: "Fever" });
    });
    expect(result.current.idempotencyKey).not.toBe(afterStatus);
  });

  it("keeps the key across a refused or dropped submission: nothing was stored under it", () => {
    const { result } = renderForm();
    act(() => {
      result.current.editRow(STUDENT_ID, { status: "absent" });
    });
    const sent = result.current.idempotencyKey;

    // A refusal marks the rows the server named; a dropped request changes nothing at all.
    act(() => {
      result.current.setIssues(new Map([[STUDENT_ID, "Not enrolled in this section."]]));
    });
    expect(result.current.rows[0]?.issue).toBe("Not enrolled in this section.");
    expect(result.current.idempotencyKey).toBe(sent);

    act(() => {
      result.current.setIssues(new Map());
    });
    expect(result.current.idempotencyKey).toBe(sent);
    expect(result.current.rows[0]?.draft.status).toBe("absent");
  });

  it("makes a new key after a success, and clears the edits onto the saved records", () => {
    const { result } = renderForm();
    act(() => {
      result.current.editRow(STUDENT_ID, { status: "absent" });
    });
    const beforeSave = result.current.idempotencyKey;

    act(() => {
      result.current.markSaved();
    });

    expect(result.current.idempotencyKey).not.toBe(beforeSave);
    // The edit is gone: the row reads its record again (still unmarked here).
    expect(result.current.rows[0]?.draft.status).toBe("");
  });

  it("marks every unmarked editable row present, skipping leave and locked rows", () => {
    const { result } = renderForm();
    const beforeKey = result.current.idempotencyKey;

    act(() => {
      result.current.markAllPresent();
    });

    const statuses = Object.fromEntries(
      result.current.rows.map((row) => [row.entry.student_id, row.draft.status]),
    );
    expect(statuses).toEqual({
      [STUDENT_ID]: "present",
      // Leave rows show their saved state; Bilal has no record, so no markable status.
      [OTHER_STUDENT_ID]: "",
      [THIRD_STUDENT_ID]: "absent",
      // Already marked: left as it was.
      [FOURTH_STUDENT_ID]: "late",
    });
    expect(result.current.idempotencyKey).not.toBe(beforeKey);
  });

  it("holds Submit until every editable row has a status", () => {
    const { result } = renderForm();
    expect(result.current.canSubmit).toBe(false);
    expect(result.current.unmarkedEditable).toBe(1);

    act(() => {
      result.current.editRow(STUDENT_ID, { status: "present" });
    });

    expect(result.current.canSubmit).toBe(true);
    expect(result.current.unmarkedEditable).toBe(0);
  });

  it("holds Submit while a row's check-out isn't after its check-in", () => {
    const { result } = renderForm();
    act(() => {
      result.current.editRow(STUDENT_ID, {
        status: "half_day",
        checkInTime: "09:00",
        checkOutTime: "09:00",
      });
    });

    expect(result.current.rows[0]?.leavesBeforeArriving).toBe(true);
    expect(result.current.canSubmit).toBe(false);

    act(() => {
      result.current.editRow(STUDENT_ID, { checkOutTime: "11:30" });
    });

    expect(result.current.rows[0]?.leavesBeforeArriving).toBe(false);
    expect(result.current.canSubmit).toBe(true);
  });

  it("sends the editable rows only: no leave row, no locked row", () => {
    const { result } = renderForm();
    act(() => {
      result.current.editRow(STUDENT_ID, { status: "half_day", checkOutTime: "11:30" });
    });

    expect(result.current.buildEntries()).toEqual([
      {
        studentId: STUDENT_ID,
        status: "half_day",
        checkInTime: undefined,
        checkOutTime: "11:30",
        remarks: undefined,
      },
      {
        studentId: FOURTH_STUDENT_ID,
        status: "late",
        checkInTime: "08:20",
        checkOutTime: undefined,
        remarks: undefined,
      },
    ]);
  });

  it("ignores an edit to a row that isn't editable", () => {
    const { result } = renderForm();
    const key = result.current.idempotencyKey;

    act(() => {
      result.current.editRow(THIRD_STUDENT_ID, { status: "present" });
    });

    expect(result.current.rows[2]?.draft.status).toBe("absent");
    expect(result.current.idempotencyKey).toBe(key);
  });

  it("keeps an edit across a reload, and drops it on a row that came back locked", () => {
    const { result, rerender } = renderForm();
    act(() => {
      result.current.editRow(STUDENT_ID, { status: "absent" });
      result.current.editRow(FOURTH_STUDENT_ID, { status: "present" });
    });

    const reloaded = roster().map((entry) =>
      entry.student_id === FOURTH_STUDENT_ID && entry.record
        ? { ...entry, record: { ...entry.record, is_locked: true } }
        : entry,
    );
    rerender({ rows: reloaded, canMark: true });

    expect(result.current.rows[0]?.draft.status).toBe("absent");
    expect(result.current.rows[3]?.mode).toBe("locked");
    expect(result.current.rows[3]?.draft.status).toBe("late");
  });

  it("offers nothing to send on a date that can't be marked", () => {
    const { result } = renderForm(roster(), false);

    expect(result.current.editableCount).toBe(0);
    expect(result.current.canSubmit).toBe(false);
    expect(result.current.buildEntries()).toEqual([]);
  });
});

describe("registerGridReducer", () => {
  const blank: RowDraft = { status: "", checkInTime: "", checkOutTime: "", remarks: "" };
  const loaded = { edits: new Map<string, RowDraft>(), idempotencyKey: "key-load" };

  it("stores the key each grid-changing action carries", () => {
    const edited = registerGridReducer(loaded, {
      type: "edit",
      key: "key-edit",
      studentId: STUDENT_ID,
      saved: blank,
      patch: { status: "late" },
    });
    expect(edited.idempotencyKey).toBe("key-edit");
    expect(edited.edits.get(STUDENT_ID)?.status).toBe("late");

    const allPresent = registerGridReducer(edited, {
      type: "markAllPresent",
      key: "key-all-present",
      rows: [{ studentId: OTHER_STUDENT_ID, draft: blank }],
    });
    expect(allPresent.idempotencyKey).toBe("key-all-present");
    expect(allPresent.edits.get(OTHER_STUDENT_ID)?.status).toBe("present");

    const saved = registerGridReducer(allPresent, { type: "saved", key: "key-saved" });
    expect(saved.idempotencyKey).toBe("key-saved");
    expect(saved.edits.size).toBe(0);
  });

  it("is pure: the same update run twice gives the same state, key included", () => {
    const action = {
      type: "edit",
      key: "key-edit",
      studentId: STUDENT_ID,
      saved: blank,
      patch: { status: "absent" },
    } as const;

    expect(registerGridReducer(loaded, action)).toEqual(registerGridReducer(loaded, action));
  });

  it("builds a later edit on the row's earlier one, not on its record", () => {
    const first = registerGridReducer(loaded, {
      type: "edit",
      key: "key-1",
      studentId: STUDENT_ID,
      saved: blank,
      patch: { status: "half_day" },
    });
    const second = registerGridReducer(first, {
      type: "edit",
      key: "key-2",
      studentId: STUDENT_ID,
      saved: blank,
      patch: { checkOutTime: "11:30" },
    });

    expect(second.edits.get(STUDENT_ID)).toEqual({
      ...blank,
      status: "half_day",
      checkOutTime: "11:30",
    });
    expect(second.idempotencyKey).toBe("key-2");
  });

  it("keeps the state, key included, when Mark all present finds every row already marked", () => {
    const marked = registerGridReducer(loaded, {
      type: "edit",
      key: "key-marked",
      studentId: STUDENT_ID,
      saved: blank,
      patch: { status: "absent" },
    });

    const after = registerGridReducer(marked, {
      type: "markAllPresent",
      key: "key-unused",
      rows: [{ studentId: STUDENT_ID, draft: blank }],
    });

    expect(after).toBe(marked);
    expect(after.idempotencyKey).toBe("key-marked");
    expect(after.edits.get(STUDENT_ID)?.status).toBe("absent");
  });
});
