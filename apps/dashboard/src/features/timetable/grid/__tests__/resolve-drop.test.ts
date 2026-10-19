import { cellKey } from "@/services/modules/timetable-slots/timetable-slots-helper";
import {
  PERIOD_1_ID,
  PERIOD_2_ID,
  slotRecord,
} from "@/services/modules/timetable-slots/__tests__/timetable-slots-fixtures";

import { isDraggableCell, keyboardStep, nextCellInDirection, resolveDrop } from "../resolve-drop";

const SOURCE = { dayOfWeek: 0, periodId: PERIOD_1_ID };
const OPEN = { isBreak: false, runsOnDay: true };

function cellsWith(...positions: { dayOfWeek: number; periodId: string }[]) {
  return new Map(
    positions.map((p) => [
      cellKey(p.dayOfWeek, p.periodId),
      {
        slot: slotRecord({ day_of_week: p.dayOfWeek, period_id: p.periodId }),
        replacesPublished: false,
      },
    ]),
  );
}

describe("resolveDrop", () => {
  const cells = cellsWith(SOURCE, { dayOfWeek: 1, periodId: PERIOD_1_ID });

  it("moves a draft into an empty teaching cell", () => {
    expect(
      resolveDrop(SOURCE, { dayOfWeek: 2, periodId: PERIOD_2_ID, ...OPEN }, cells, cellKey),
    ).toEqual({
      ok: true,
      target: { dayOfWeek: 2, periodId: PERIOD_2_ID },
    });
  });

  it.each([
    ["same", { ...SOURCE, ...OPEN }],
    ["occupied", { dayOfWeek: 1, periodId: PERIOD_1_ID, ...OPEN }],
    ["break", { dayOfWeek: 2, periodId: PERIOD_2_ID, isBreak: true, runsOnDay: true }],
    ["notRunning", { dayOfWeek: 2, periodId: PERIOD_2_ID, isBreak: false, runsOnDay: false }],
  ] as const)("refuses %s", (reason, target) => {
    expect(resolveDrop(SOURCE, target, cells, cellKey)).toEqual({ ok: false, reason });
  });
});

describe("isDraggableCell", () => {
  it("allows only a pure draft", () => {
    expect(isDraggableCell({ slot: slotRecord(), replacesPublished: false })).toBe(true);
    expect(isDraggableCell({ slot: slotRecord(), replacesPublished: true })).toBe(false);
    expect(
      isDraggableCell({ slot: slotRecord({ status: "published" }), replacesPublished: false }),
    ).toBe(false);
    expect(isDraggableCell(undefined)).toBe(false);
  });
});

describe("nextCellInDirection", () => {
  const box = (left: number, top: number) => ({ left, top, width: 100, height: 50 });
  const grid = [
    { id: "a", box: box(0, 0) },
    { id: "b", box: box(100, 0) },
    { id: "c", box: box(200, 0) },
    { id: "d", box: box(0, 50) },
    { id: "e", box: box(100, 50) },
  ];

  it("steps one cell along the row or column", () => {
    expect(nextCellInDirection(box(0, 0), grid, "right")?.id).toBe("b");
    expect(nextCellInDirection(box(100, 0), grid, "down")?.id).toBe("e");
    expect(nextCellInDirection(box(100, 50), grid, "left")?.id).toBe("d");
    expect(nextCellInDirection(box(0, 50), grid, "up")?.id).toBe("a");
  });

  it("stops at the edge", () => {
    expect(nextCellInDirection(box(200, 0), grid, "right")).toBeNull();
  });
});

describe("keyboardStep", () => {
  const box = (left: number, top: number, width = 100, height = 50) => ({
    left,
    top,
    width,
    height,
  });
  const cells = [
    { id: "a", box: box(0, 0) },
    { id: "b", box: box(100, 0) },
    { id: "d", box: box(0, 50) },
    { id: "e", box: box(100, 50) },
  ];
  // The handle: a small box in the top inline-end corner of cell "b".
  const handle = box(170, 2, 28, 28);
  const overB = { id: "b", box: box(100, 0) };

  it("measures from the cell, so Left and Down never land back on it", () => {
    expect(keyboardStep(handle, overB, cells, "left")).toEqual({ left: 70, top: 2 });
    expect(keyboardStep(handle, overB, cells, "down")).toEqual({ left: 170, top: 52 });
  });

  it("finds the handle's own cell when no cell is reported yet", () => {
    // The first arrow press comes before dnd-kit has measured a collision.
    expect(keyboardStep(handle, null, cells, "left")).toEqual({ left: 70, top: 2 });
  });

  it("stops at the edge of the grid", () => {
    expect(keyboardStep(handle, overB, cells, "right")).toBeNull();
    expect(keyboardStep(handle, overB, cells, "up")).toBeNull();
  });
});
