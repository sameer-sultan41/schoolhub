"use client";

import { useTranslations } from "next-intl";
import { Badge, Button, Card } from "@schoolhub/ui";
import { CircleAlert, TriangleAlert } from "lucide-react";

import type { TimetableConflict } from "@/services";
import { useConflictText } from "./use-conflict-text";

export interface ConflictPanelProps {
  conflicts: readonly TimetableConflict[];
  /** Whether a check has run, so an empty list can say "No conflicts found." */
  checked: boolean;
  /** A slot's cell label when it is in this grid, else `undefined`. */
  cellLabelFor: (slotId: string) => string | undefined;
  onGoTo: (slotId: string) => void;
}

/**
 * Every finding from the last write, `:validate` run or refused publish, in the server's
 * order (hard first; never re-sorted). Severity is an icon and a word, never colour alone.
 * The empty message sits outside the list, so "the list is gone" is a fact a test can check.
 * One `role="status"` region, not an alert per finding: nine clashes are one announcement.
 */
export function ConflictPanel({ conflicts, checked, cellLabelFor, onGoTo }: ConflictPanelProps) {
  const t = useTranslations("timetable");
  const conflictText = useConflictText();

  if (conflicts.length === 0) {
    return checked ? (
      <p role="status" className="text-sm text-muted-foreground">
        {t("conflicts.none")}
      </p>
    ) : null;
  }

  return (
    <Card role="status" className="p-4">
      <ul aria-label={t("conflicts.title")} className="space-y-2">
        {conflicts.map((conflict) => {
          const isHard = conflict.severity === "hard";
          const Icon = isHard ? CircleAlert : TriangleAlert;
          // The first cell of *this* grid the finding names: a teacher or room clash also names
          // another section's slot, which has nothing here to go to.
          const firstSlot = conflict.slot_ids.find((slotId) => cellLabelFor(slotId) !== undefined);
          const cellLabel = firstSlot ? cellLabelFor(firstSlot) : undefined;
          return (
            <li
              key={`${conflict.type}-${conflict.slot_ids.join("-")}`}
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              <Icon
                className={isHard ? "size-4 text-danger" : "size-4 text-warning"}
                aria-hidden="true"
              />
              <Badge variant={isHard ? "destructive" : "warning"} appearance="light">
                {t(`conflicts.severity.${conflict.severity}`)}
              </Badge>
              <span className="text-foreground">{conflictText(conflict)}</span>
              {firstSlot && cellLabel && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onGoTo(firstSlot);
                  }}
                >
                  {t("conflicts.goTo", { cell: cellLabel })}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
