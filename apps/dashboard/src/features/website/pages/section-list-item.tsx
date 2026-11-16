"use client";

import type { CSSProperties } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { useTranslations } from "next-intl";
import { Badge, Button, cn } from "@schoolhub/ui";
import { AlertCircle, ArrowDown, ArrowUp, EyeOff, GripVertical, Trash2 } from "lucide-react";

export interface SectionListItemProps {
  /** The section's client key: the sortable id. */
  id: string;
  index: number;
  count: number;
  label: string;
  isVisible: boolean;
  isSelected: boolean;
  hasError: boolean;
  /** Holds drag, move, remove and selecting another section while an upload or a save runs. */
  locked: boolean;
  /** The viewer can't edit: no drag, move or remove at all. */
  readOnly: boolean;
  onSelect: () => void;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}

/** One row of the section list: its drag handle, its name (which selects it), whether it is
 * hidden or needs attention, and its move and remove buttons. */
export function SectionListItem({
  id,
  index,
  count,
  label,
  isVisible,
  isSelected,
  hasError,
  locked,
  readOnly,
  onSelect,
  onMove,
  onRemove,
}: SectionListItemProps) {
  const t = useTranslations("website.pages.editor");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: locked || readOnly,
    attributes: { roleDescription: t("sortableRole") },
  });
  const position = index + 1;
  const style: CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    zIndex: isDragging ? 2 : undefined,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      aria-label={t("sectionLabel", { index: position, type: label })}
      className={cn(
        "flex items-center gap-1 rounded-md border bg-background p-1.5",
        isSelected ? "border-primary" : "border-border",
        hasError && "border-destructive",
      )}
    >
      {readOnly ? null : (
        <Button
          variant="ghost"
          mode="icon"
          size="sm"
          disabled={locked}
          {...attributes}
          {...listeners}
          aria-label={t("dragHandle", { index: position })}
        >
          <GripVertical aria-hidden="true" />
        </Button>
      )}
      <button
        type="button"
        aria-pressed={isSelected}
        // While an upload runs, leaving the section would unmount its image field and drop the
        // upload's result, so only the section being edited stays selectable.
        disabled={locked && !isSelected}
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1.5 py-1 text-start text-sm font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="truncate">{t("sectionName", { index: position, type: label })}</span>
        {isVisible ? null : (
          <Badge variant="secondary" appearance="light" size="sm">
            <EyeOff aria-hidden="true" />
            {t("hidden")}
          </Badge>
        )}
        {hasError ? (
          <span className="flex items-center gap-1 text-xs text-destructive">
            <AlertCircle aria-hidden="true" className="size-3.5" />
            {t("needsAttention")}
          </span>
        ) : null}
      </button>
      {readOnly ? null : (
        <>
          <Button
            variant="ghost"
            mode="icon"
            size="sm"
            disabled={locked || index === 0}
            aria-label={t("moveUp", { index: position })}
            onClick={() => {
              onMove(index, index - 1);
            }}
          >
            <ArrowUp aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            mode="icon"
            size="sm"
            disabled={locked || index === count - 1}
            aria-label={t("moveDown", { index: position })}
            onClick={() => {
              onMove(index, index + 1);
            }}
          >
            <ArrowDown aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            mode="icon"
            size="sm"
            disabled={locked}
            aria-label={t("remove", { index: position })}
            onClick={() => {
              onRemove(index);
            }}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </>
      )}
    </li>
  );
}
