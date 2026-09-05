"use client";

import { Badge } from "@schoolhub/ui";
import { useTranslations } from "next-intl";
import { CONFLICT_SEVERITY_VARIANT } from "@/features/timetable/timetable-constants";
import type { TimetableConflict } from "@/features/timetable/timetable-types";

/** Index a conflict list by every slot it names, so a cell can show its own
 * findings. A double booking names both sides (conflicts.Conflict's docstring),
 * so the same finding appears under two keys — deliberately: each cell has to be
 * able to explain itself without reading the whole list. */
export function conflictsBySlot(conflicts: TimetableConflict[]): Map<string, TimetableConflict[]> {
  const index = new Map<string, TimetableConflict[]>();
  for (const conflict of conflicts) {
    for (const slotId of conflict.slot_ids) {
      const existing = index.get(slotId);
      if (existing) existing.push(conflict);
      else index.set(slotId, [conflict]);
    }
  }
  return index;
}

export function hasHardConflicts(conflicts: TimetableConflict[]): boolean {
  return conflicts.some((conflict) => conflict.severity === "hard");
}

/** A `type` this app has a translation for renders translated; anything else
 * falls back to the server's own `message`. Same rule the error envelope
 * follows, and it means a detector shipping server-side still says something
 * useful before the dashboard has ever heard of it. */
function useConflictText() {
  const t = useTranslations("timetable");
  return (conflict: TimetableConflict) =>
    t.has(`conflicts.types.${conflict.type}`)
      ? t(`conflicts.types.${conflict.type}`)
      : conflict.message;
}

const SEVERITY_BORDER: Record<TimetableConflict["severity"], string> = {
  hard: "border-danger/40 bg-danger/10",
  soft: "border-warning/50 bg-warning/15",
};

interface ConflictListProps {
  conflicts: TimetableConflict[];
  /** Shown instead of the list when there is nothing to report. Omit to render
   * nothing at all — right for a cell, wrong for the validation panel. */
  emptyMessage?: string;
}

/**
 * The conflict panel: every finding from a per-edit check, a `:validate` run or a
 * refused publish, hard ones first.
 *
 * `conflicts.detect_conflicts` already sorts hard before soft, and this does not
 * re-sort — the server's order is the contract ("a client showing the top few
 * must not lead with a warning while a blocking clash sits below the fold").
 *
 * Deliberately not one `<Alert variant="danger">` per finding: that component
 * carries `role="alert"`, and a validation run that turns up nine clashes would
 * then fire nine assertive announcements over each other. The list is announced
 * once, by its own `role="status"` container in the caller.
 */
export function ConflictList({ conflicts, emptyMessage }: ConflictListProps) {
  const t = useTranslations("timetable");
  const conflictText = useConflictText();

  if (conflicts.length === 0) {
    return emptyMessage ? <p className="text-sm text-muted-foreground">{emptyMessage}</p> : null;
  }

  return (
    <ul aria-label={t("conflicts.title")} className="space-y-2">
      {conflicts.map((conflict) => (
        <li
          key={`${conflict.type}-${conflict.slot_ids.join("-")}`}
          className={`flex flex-wrap items-center gap-2 rounded-[var(--sh-radius)] border px-3 py-2 text-sm ${
            SEVERITY_BORDER[conflict.severity]
          }`}
        >
          <Badge variant={CONFLICT_SEVERITY_VARIANT[conflict.severity]}>
            {t(`conflicts.severity.${conflict.severity}`)}
          </Badge>
          <span className="text-foreground">{conflictText(conflict)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The compact form for one grid cell: no badges, no box — the cell already
 * carries the severity in its own border, and a cell is far too small for the
 * panel's layout. */
export function CellConflicts({ conflicts }: { conflicts: TimetableConflict[] }) {
  const conflictText = useConflictText();

  if (conflicts.length === 0) return null;

  return (
    <ul className="mt-1 space-y-0.5">
      {conflicts.map((conflict) => (
        <li
          key={`${conflict.type}-${conflict.slot_ids.join("-")}`}
          className={
            conflict.severity === "hard" ? "text-xs text-danger" : "text-xs text-muted-foreground"
          }
        >
          {conflictText(conflict)}
        </li>
      ))}
    </ul>
  );
}
