"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useTranslations } from "next-intl";

import type { SectionFormValue } from "./sections-model";
import { SectionListItem } from "./section-list-item";

/** A pointer drag starts only past this many pixels, so a click on the handle stays a click. */
const DRAG_ACTIVATION_DISTANCE = 4;

export interface SectionListProps {
  sections: readonly SectionFormValue[];
  selectedKey: string | null;
  errorKeys: ReadonlySet<string>;
  labelOf: (type: string) => string;
  locked: boolean;
  readOnly: boolean;
  onSelect: (key: string) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}

/**
 * The page's sections in order: reordered by drag (pointer, or keyboard with translated
 * announcements) or by the move buttons, selected for editing, removed. Every change stays in
 * the form until Save sends the whole list.
 */
export function SectionList({
  sections,
  selectedKey,
  errorKeys,
  labelOf,
  locked,
  readOnly,
  onSelect,
  onMove,
  onRemove,
}: SectionListProps) {
  const t = useTranslations("website.pages.editor");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = sections.map((section) => section.key);
  const positionOf = (id: string | number) => ids.indexOf(String(id)) + 1;

  const announcements: Announcements = {
    onDragStart: ({ active }) => t("dragStart", { index: positionOf(active.id) }),
    onDragOver: ({ active, over }) =>
      over
        ? t("dragOver", { index: positionOf(active.id), position: positionOf(over.id) })
        : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? t("dragEnd", { index: positionOf(active.id), position: positionOf(over.id) })
        : t("dragCancel"),
    onDragCancel: () => t("dragCancel"),
  };

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from >= 0 && to >= 0) onMove(from, to);
  }

  if (sections.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: t("dragInstructions") },
      }}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ol className="space-y-2" aria-label={t("sectionsHeading")}>
          {sections.map((section, index) => (
            <SectionListItem
              key={section.key}
              id={section.key}
              index={index}
              count={sections.length}
              label={labelOf(section.section_type)}
              isVisible={section.is_visible}
              isSelected={section.key === selectedKey}
              hasError={errorKeys.has(section.key)}
              locked={locked}
              readOnly={readOnly}
              onSelect={() => {
                onSelect(section.key);
              }}
              onMove={onMove}
              onRemove={onRemove}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
