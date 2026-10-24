"use client";

import type { ReactNode } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import { Badge, BadgeDot, Button, cn } from "@schoolhub/ui";
import { GripVertical, X } from "lucide-react";

import type { TimetableConflict, TimetableSlotRecord } from "@/services";
import type { GridCell } from "@/services/modules/timetable-slots/timetable-slots-helper";
import type { DropTarget, GridPosition } from "./resolve-drop";
import { useConflictText } from "./use-conflict-text";

/** The id a conflict's "Go to" button focuses, and the move's focus target. */
export function cellButtonId(slotId: string): string {
  return `timetable-cell-${slotId}`;
}

/**
 * Every position is a drop target, inert ones included, carrying what `resolveDrop` needs: a
 * drop on a break is then refused with its reason rather than snapping to a nearby cell.
 */
function DroppableCell({
  id,
  target,
  className,
  children,
}: {
  id: string;
  target: DropTarget;
  className: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, data: target });
  return (
    <td ref={setNodeRef} className={cn(className, isOver && "ring-2 ring-primary ring-inset")}>
      {children}
    </td>
  );
}

/**
 * A pure draft's drag handle: a separate button, so clicking the cell or pressing Space/Enter
 * on it still opens the editor. `touch-action: none` on the handle only, so a finger on the
 * rest of the grid still scrolls it.
 */
function DragHandle({
  slot,
  position,
  label,
}: {
  slot: TimetableSlotRecord;
  position: GridPosition;
  label: string;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform } = useDraggable({
    id: slot.id,
    data: position,
  });
  return (
    <span
      ref={setNodeRef}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
    >
      <Button
        ref={setActivatorNodeRef}
        variant="ghost"
        mode="icon"
        size="sm"
        className="touch-none"
        aria-label={label}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </Button>
    </span>
  );
}

/** What a filled cell shows; its `id` lets the cell's button describe itself with it. */
function SlotContent({ id, cell }: { id: string; cell: GridCell }) {
  const t = useTranslations("timetable");
  const { slot } = cell;
  return (
    <span id={id} className="block space-y-0.5 text-start">
      <span className="block font-medium text-foreground">
        {slot.subject_name ?? t("grid.noSubject")}
      </span>
      {slot.staff_name && (
        <span className="block text-xs text-muted-foreground">{slot.staff_name}</span>
      )}
      {slot.room_name && (
        <span className="block text-xs text-muted-foreground">{slot.room_name}</span>
      )}
      <Badge
        variant={slot.status === "draft" ? "secondary" : "success"}
        appearance="light"
        size="sm"
      >
        <BadgeDot />
        {slot.status === "draft" ? t("grid.draft") : t("grid.publishedBadge")}
      </Badge>
      {cell.replacesPublished && (
        <span className="block text-xs text-muted-foreground">{t("grid.replacesPublished")}</span>
      )}
    </span>
  );
}

export interface SlotCellProps {
  dayOfWeek: number;
  periodId: string;
  /** "Monday · Period 1". */
  label: string;
  isBreak: boolean;
  runsOnDay: boolean;
  dropId: string;
  cell: GridCell | undefined;
  conflicts: readonly TimetableConflict[];
  /** Whether this viewer may open the cell's editor (fill, edit or draft over). */
  canOpen: boolean;
  canDrag: boolean;
  canDiscard: boolean;
  onOpen: () => void;
  onDiscard: (slot: TimetableSlotRecord) => void;
}

/**
 * One cell of the week grid. A break, or a day the period doesn't run, is inert. A slot that
 * sits on such a position anyway (its period changed after it was placed) still shows, with
 * its conflicts and, for a draft, Discard: hiding it would leave a publish-blocking finding
 * with nothing to fix it from.
 */
export function SlotCell(props: SlotCellProps) {
  const t = useTranslations("timetable");
  const conflictText = useConflictText();
  const { cell, conflicts, label } = props;
  const slot = cell?.slot;
  const inert = props.isBreak || !props.runsOnDay;
  const target: DropTarget = {
    dayOfWeek: props.dayOfWeek,
    periodId: props.periodId,
    isBreak: props.isBreak,
    runsOnDay: props.runsOnDay,
  };

  if (inert && !cell) {
    return (
      <DroppableCell
        id={props.dropId}
        target={target}
        className="border border-border bg-muted px-3 py-2 text-xs text-muted-foreground"
      >
        {props.isBreak ? t("grid.break") : t("grid.notScheduled")}
      </DroppableCell>
    );
  }

  const hasHard = conflicts.some((conflict) => conflict.severity === "hard");
  const tone = hasHard
    ? "border-danger bg-danger/10"
    : conflicts.length > 0
      ? "border-warning bg-warning/10"
      : inert
        ? "border-border bg-muted"
        : "border-border";
  const contentId = slot ? `${cellButtonId(slot.id)}-content` : undefined;
  const content =
    cell && contentId ? (
      <SlotContent id={contentId} cell={cell} />
    ) : (
      <span className="block text-xs text-muted-foreground">{t("grid.emptyCell")}</span>
    );

  return (
    <DroppableCell
      id={props.dropId}
      target={target}
      className={cn("border px-1 py-1 align-top", tone)}
    >
      <div className="flex items-start gap-1">
        {props.canOpen && !inert ? (
          <Button
            id={slot ? cellButtonId(slot.id) : undefined}
            variant="ghost"
            className="h-auto min-w-0 flex-1 justify-start px-2 py-1.5"
            aria-label={
              slot ? t("grid.editCell", { cell: label }) : t("grid.fillCell", { cell: label })
            }
            aria-describedby={contentId}
            onClick={props.onOpen}
          >
            {content}
          </Button>
        ) : (
          <div
            id={slot ? cellButtonId(slot.id) : undefined}
            tabIndex={slot ? -1 : undefined}
            className="min-w-0 flex-1 px-2 py-1.5"
          >
            {inert && (
              <span className="block text-xs text-muted-foreground">
                {props.isBreak ? t("grid.break") : t("grid.notScheduled")}
              </span>
            )}
            {content}
          </div>
        )}
        <div className="flex flex-col">
          {slot && props.canDrag && !inert && (
            <DragHandle
              slot={slot}
              position={{ dayOfWeek: props.dayOfWeek, periodId: props.periodId }}
              label={t("grid.moveCell", { cell: label })}
            />
          )}
          {slot?.status === "draft" && props.canDiscard && (
            <Button
              variant="ghost"
              mode="icon"
              size="sm"
              aria-label={t("slot.actions.discardCell", { cell: label })}
              onClick={() => {
                props.onDiscard(slot);
              }}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
      {conflicts.length > 0 && (
        <ul className="mt-1 space-y-0.5 px-2">
          {conflicts.map((conflict) => (
            <li
              key={`${conflict.type}-${conflict.slot_ids.join("-")}`}
              className={
                conflict.severity === "hard"
                  ? "text-xs text-danger"
                  : "text-xs text-muted-foreground"
              }
            >
              {conflictText(conflict)}
            </li>
          ))}
        </ul>
      )}
    </DroppableCell>
  );
}
