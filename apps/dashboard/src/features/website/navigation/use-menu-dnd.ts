"use client";

import type { CSSProperties } from "react";
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { useTranslations } from "next-intl";

/** A pointer drag starts only past this many pixels, so a click on the handle stays a click. */
const DRAG_ACTIVATION_DISTANCE = 4;

/**
 * Drag to reorder one level of a menu (its links, or one link's sub-links), by pointer or
 * keyboard, with translated screen-reader announcements by position. `ids` are the field
 * array's own keys; `move` is its `move`.
 */
export function useMenuDnd(ids: readonly string[], move: (from: number, to: number) => void) {
  const t = useTranslations("website.navigation.drag");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const positionOf = (id: string | number) => ids.indexOf(String(id)) + 1;

  const announcements: Announcements = {
    onDragStart: ({ active }) => t("start", { index: positionOf(active.id) }),
    onDragOver: ({ active, over }) =>
      over ? t("over", { index: positionOf(active.id), position: positionOf(over.id) }) : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? t("end", { index: positionOf(active.id), position: positionOf(over.id) })
        : t("cancel"),
    onDragCancel: () => t("cancel"),
  };

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from >= 0 && to >= 0) move(from, to);
  }

  return {
    sensors,
    accessibility: { announcements, screenReaderInstructions: { draggable: t("instructions") } },
    onDragEnd,
  };
}

/** One sortable row: its node ref, its moving style and its drag handle's props. */
export function useSortableRow(id: string) {
  const t = useTranslations("website.navigation.drag");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    attributes: { roleDescription: t("role") },
  });
  const style: CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    zIndex: isDragging ? 2 : undefined,
  };
  return { setNodeRef, style, handleProps: { ...attributes, ...listeners } };
}
