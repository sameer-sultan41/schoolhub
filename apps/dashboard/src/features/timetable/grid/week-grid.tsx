"use client";

import { useEffect, useMemo } from "react";
import {
  DndContext,
  KeyboardSensor,
  pointerWithin,
  PointerSensor,
  rectIntersection,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useTranslations } from "next-intl";

import type { PeriodRecord, TimetableConflict, TimetableSlotRecord } from "@/services";
import { DRAG_ACTIVATION_DISTANCE } from "@/services/modules/timetable-slots/timetable-slots-constant";
import {
  cellKey,
  conflictsBySlot,
  periodRunsOn,
  toShortTimeRange,
  type GridCell,
} from "@/services/modules/timetable-slots/timetable-slots-helper";
import { gridCoordinateGetter } from "./grid-keyboard";
import {
  isDraggableCell,
  resolveDrop,
  type DropRefusal,
  type DropTarget,
  type GridPosition,
} from "./resolve-drop";
import { SlotCell } from "./slot-cell";
import { useCellLabel } from "./use-cell-label";

/**
 * A drop lands on the cell the drag is inside, or nowhere. A pointer drop is the cell under
 * the pointer (outside the grid, no drop at all). A keyboard drag has no pointer: the dragged
 * box is the handle, which `keyboardStep` keeps inside one cell, so the cell it overlaps is
 * the one. Not `closestCenter`: the handle sits in a corner of its cell, so the nearest cell
 * *centre* is often the neighbour's, and an always-something answer moves a class the user
 * never dropped.
 */
const collisionDetection: CollisionDetection = (args) => {
  const found = args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args);
  // DIAG: temporary, never merged.
  const rect = args.collisionRect;
  console.warn(
    `DIAG collide t=${Math.round(performance.now())} pointer=${String(!!args.pointerCoordinates)} ` +
      `rect=${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)} ` +
      `found=${found.map((c) => String(c.id)).join(";")}`,
  );
  return found;
};

export interface WeekGridProps {
  periods: readonly PeriodRecord[];
  weekdays: readonly number[];
  cells: ReadonlyMap<string, GridCell>;
  conflicts: readonly TimetableConflict[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onOpenCell: (position: GridPosition, cell: GridCell | undefined) => void;
  onDiscard: (slot: TimetableSlotRecord) => void;
  onMove: (slot: TimetableSlotRecord, target: GridPosition) => void;
  /** A drop the grid refused, with the reason, for the sighted user the announcement misses. */
  onRefused: (reason: string) => void;
}

/**
 * One section's week: weekday columns, period rows. Clicking a cell opens its editor; a pure
 * draft also has a drag handle that moves it to an empty teaching cell (pointer or keyboard,
 * one cell per arrow key). Every drop is decided by `resolveDrop` before any request.
 */
export function WeekGrid(props: WeekGridProps) {
  const t = useTranslations("timetable");
  const cellLabel = useCellLabel();
  const { periods, weekdays, cells } = props;
  useEffect(() => {
    // DIAG: temporary, never merged.
    const log = (event: KeyboardEvent) => {
      console.warn(`DIAG keydown t=${Math.round(performance.now())} code=${event.code}`);
    };
    window.addEventListener("keydown", log, true);
    return () => {
      window.removeEventListener("keydown", log, true);
    };
  }, []);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE } }),
    useSensor(KeyboardSensor, { coordinateGetter: gridCoordinateGetter }),
  );
  const conflictIndex = useMemo(() => conflictsBySlot(props.conflicts), [props.conflicts]);
  const periodById = useMemo(() => new Map(periods.map((p) => [p.id, p])), [periods]);

  const labelOf = (position: GridPosition) =>
    cellLabel(position.dayOfWeek, periodById.get(position.periodId)?.name ?? "");
  const reasonText = (reason: DropRefusal) => t(`grid.dropReasons.${reason}`);
  const decide = (source: GridPosition | undefined, target: DropTarget | undefined) =>
    source && target ? resolveDrop(source, target, cells, cellKey) : null;

  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      t("grid.dragStart", { cell: labelOf(active.data.current as GridPosition) }),
    onDragOver: ({ active, over }) => {
      const target = over?.data.current as DropTarget | undefined;
      const decision = decide(active.data.current as GridPosition, target);
      if (!target || !decision) return undefined;
      return decision.ok
        ? t("grid.dragOver", { cell: labelOf(target) })
        : t("grid.dragOverInvalid", { cell: labelOf(target), reason: reasonText(decision.reason) });
    },
    onDragEnd: ({ active, over }) => {
      const decision = decide(
        active.data.current as GridPosition,
        over?.data.current as DropTarget,
      );
      if (!decision) return t("grid.dragCancel");
      return decision.ok
        ? t("grid.dragEnd", { cell: labelOf(decision.target) })
        : t("grid.dragEndInvalid", { reason: reasonText(decision.reason) });
    },
    onDragCancel: () => t("grid.dragCancel"),
  };

  function handleDragEnd({ active, over }: DragEndEvent) {
    const source = active.data.current as GridPosition | undefined;
    const decision = decide(source, over?.data.current as DropTarget | undefined);
    const cell = source ? cells.get(cellKey(source.dayOfWeek, source.periodId)) : undefined;
    if (decision?.ok && cell) props.onMove(cell.slot, decision.target);
    // Dropped back where it started is no move, and needs no message.
    else if (decision && !decision.ok && decision.reason !== "same") {
      props.onRefused(t("grid.dragEndInvalid", { reason: reasonText(decision.reason) }));
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: t("grid.dragInstructions") },
      }}
      onDragEnd={handleDragEnd}
      onDragStart={({ active }) => {
        console.warn(
          `DIAG dragStart t=${Math.round(performance.now())} active=${String(active.id)}`,
        );
      }}
      onDragOver={({ over }) => {
        console.warn(`DIAG dragOver t=${Math.round(performance.now())} over=${String(over?.id)}`);
      }}
      onDragMove={({ delta, over }) => {
        console.warn(
          `DIAG dragMove t=${Math.round(performance.now())} delta=${Math.round(delta.x)},${Math.round(delta.y)} over=${String(over?.id)}`,
        );
      }}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-3xl border-collapse text-sm">
          <caption className="sr-only">{t("grid.caption")}</caption>
          <thead>
            <tr>
              <th scope="col" className="border border-border px-3 py-2 text-start">
                {t("fields.period")}
              </th>
              {weekdays.map((day) => (
                <th key={day} scope="col" className="border border-border px-3 py-2 text-start">
                  {t(`weekdays.${day}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((period) => (
              <tr key={period.id}>
                <th scope="row" className="border border-border px-3 py-2 text-start align-top">
                  <span className="font-medium text-foreground">{period.name}</span>
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    {toShortTimeRange(period.start_time, period.end_time)}
                  </span>
                </th>
                {weekdays.map((day) => {
                  const key = cellKey(day, period.id);
                  const cell = cells.get(key);
                  const slot = cell?.slot;
                  // Filling a cell or drafting over a published one creates; a draft updates.
                  const canOpen = slot?.status === "draft" ? props.canUpdate : props.canCreate;
                  return (
                    <SlotCell
                      key={day}
                      dayOfWeek={day}
                      periodId={period.id}
                      label={labelOf({ dayOfWeek: day, periodId: period.id })}
                      isBreak={period.is_break ?? false}
                      runsOnDay={periodRunsOn(period.weekdays, day)}
                      dropId={key}
                      cell={cell}
                      conflicts={slot ? (conflictIndex.get(slot.id) ?? []) : []}
                      canOpen={canOpen}
                      canDrag={props.canUpdate && isDraggableCell(cell)}
                      canDiscard={props.canDelete}
                      onOpen={() => {
                        props.onOpenCell({ dayOfWeek: day, periodId: period.id }, cell);
                      }}
                      onDiscard={props.onDiscard}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DndContext>
  );
}
