import type { GridCell } from "@/services/modules/timetable-slots/timetable-slots-helper";

/**
 * The week grid's drag rules, as pure functions so Jest can prove them (jsdom has no layout,
 * so a real drag can only be exercised in the browser suite).
 */

/** One cell of the grid, as a drag source or a drop target sees it. */
export interface GridPosition {
  dayOfWeek: number;
  periodId: string;
}

/** What the target cell is: a break, a period that doesn't run that day, or a real slot. */
export interface DropTarget extends GridPosition {
  isBreak: boolean;
  runsOnDay: boolean;
}

export type DropRefusal = "same" | "occupied" | "break" | "notRunning";

export type DropDecision = { ok: true; target: GridPosition } | { ok: false; reason: DropRefusal };

/**
 * Whether a dragged draft may land on `target`. A drop only ever moves a draft into an empty
 * teaching cell: never onto another class (no swap), a break, or a period that doesn't run
 * that day.
 */
export function resolveDrop(
  source: GridPosition,
  target: DropTarget,
  cells: ReadonlyMap<string, GridCell>,
  cellKey: (dayOfWeek: number, periodId: string) => string,
): DropDecision {
  if (source.dayOfWeek === target.dayOfWeek && source.periodId === target.periodId) {
    return { ok: false, reason: "same" };
  }
  if (target.isBreak) return { ok: false, reason: "break" };
  if (!target.runsOnDay) return { ok: false, reason: "notRunning" };
  if (cells.has(cellKey(target.dayOfWeek, target.periodId))) {
    return { ok: false, reason: "occupied" };
  }
  return { ok: true, target: { dayOfWeek: target.dayOfWeek, periodId: target.periodId } };
}

/** Whether a cell's slot may be dragged: a pure draft only. A published cell can't be cleared,
 * and moving a draft that replaces one would bring the published class back at the source. */
export function isDraggableCell(cell: GridCell | undefined): boolean {
  return cell !== undefined && cell.slot.status === "draft" && !cell.replacesPublished;
}

export type GridDirection = "up" | "down" | "left" | "right";

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The droppable cell an arrow key steps to from `from`: the nearest box whose centre lies that
 * way, preferring the same row or column. `null` at the edge of the grid. This is what makes a
 * keyboard drag move one cell per key press, not a fixed number of pixels.
 */
export function nextCellInDirection<TId>(
  from: Box,
  boxes: ReadonlyArray<{ id: TId; box: Box }>,
  direction: GridDirection,
): { id: TId; box: Box } | null {
  const centre = (box: Box) => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
  const origin = centre(from);
  let best: { id: TId; box: Box; score: number } | null = null;
  for (const candidate of boxes) {
    const point = centre(candidate.box);
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    // Along the axis of travel, and ahead of the origin by more than half a pixel.
    const along =
      direction === "left" ? -dx : direction === "right" ? dx : direction === "up" ? -dy : dy;
    const across = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    if (along <= 0.5) continue;
    // Drifting off the row or column costs more than going further along it.
    const score = along + across * 2;
    if (!best || score < best.score) best = { ...candidate, score };
  }
  return best ? { id: best.id, box: best.box } : null;
}

/**
 * Where a keyboard drag's dragged box moves on an arrow key: one cell on from the cell it is
 * over (`fromCell`), measured cell to cell rather than from the handle, which sits in a corner
 * of its cell and would otherwise find its own cell "ahead". The box is centred in the new
 * cell rather than kept at its offset in the old one: columns differ in width, and a handle at
 * a wide cell's far edge would otherwise land a cell further on. `null` at the edge of the grid.
 */
export function keyboardStep<TId>(
  dragged: Box,
  fromCell: { id: TId; box: Box } | null,
  cells: ReadonlyArray<{ id: TId; box: Box }>,
  direction: GridDirection,
): { left: number; top: number } | null {
  // Before the first collision is measured, dnd-kit reports no cell; the cell is then the one
  // holding the handle's centre, never "nowhere" (which would find the handle's own cell
  // ahead of it on the side it doesn't sit on).
  const centreX = dragged.left + dragged.width / 2;
  const centreY = dragged.top + dragged.height / 2;
  const current =
    fromCell ??
    cells.find(
      ({ box }) =>
        centreX >= box.left &&
        centreX <= box.left + box.width &&
        centreY >= box.top &&
        centreY <= box.top + box.height,
    ) ??
    null;
  const origin = current?.box ?? dragged;
  const candidates = current ? cells.filter((cell) => cell.id !== current.id) : cells;
  const next = nextCellInDirection(origin, candidates, direction);
  if (!next) return null;
  return {
    left: next.box.left + (next.box.width - dragged.width) / 2,
    top: next.box.top + (next.box.height - dragged.height) / 2,
  };
}
