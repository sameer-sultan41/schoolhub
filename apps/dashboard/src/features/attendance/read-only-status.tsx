"use client";

import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";
import { FilePenLine, Lock } from "lucide-react";

import {
  AttendanceStatusBadge,
  type AnyAttendanceStatus,
} from "@/features/attendance/attendance-status";

/** Why a register row can't be edited: approved leave, a locked record, or a date that can't be
 * marked. */
export type ReadOnlyRowMode = "leave" | "locked" | "readOnly";

export interface ReadOnlyStatusProps<TRecord extends { status: AnyAttendanceStatus }> {
  /** The saved record, or `null` for a row not yet marked. */
  record: TRecord | null;
  /** The student's or staff member's name, for Request correction's accessible name. */
  name: string;
  mode: ReadOnlyRowMode;
  /** Set when the viewer may ask for a locked row to change (`attendance.correction.create`). */
  onRequestCorrection?: (record: TRecord) => void;
}

/**
 * A register row's status when it can't be edited, on the student and the staff register alike:
 * "On leave", "Not marked", or the saved status, and on a locked row the lock and, for a holder
 * of the key, Request correction.
 */
export function ReadOnlyStatus<TRecord extends { status: AnyAttendanceStatus }>({
  record,
  name,
  mode,
  onRequestCorrection,
}: ReadOnlyStatusProps<TRecord>) {
  const t = useTranslations("attendance");

  if (mode === "leave") return <AttendanceStatusBadge status="on_leave" />;
  if (!record) {
    return <span className="text-sm text-muted-foreground">{t("register.notMarked")}</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <AttendanceStatusBadge status={record.status} />
      {mode === "locked" && (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="size-3.5" aria-hidden="true" />
          {t("register.locked")}
        </span>
      )}
      {mode === "locked" && onRequestCorrection && (
        <Button
          size="sm"
          variant="outline"
          aria-label={t("register.requestCorrectionFor", { name })}
          onClick={() => {
            onRequestCorrection(record);
          }}
        >
          <FilePenLine aria-hidden="true" />
          {t("register.requestCorrection")}
        </Button>
      )}
    </div>
  );
}
