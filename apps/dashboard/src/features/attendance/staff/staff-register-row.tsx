"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button, cn, Input, ToggleGroup, ToggleGroupItem } from "@schoolhub/ui";
import { LogOut } from "lucide-react";

import {
  ATTENDANCE_STATUS_ICON,
  ATTENDANCE_STATUS_SELECTED_CLASS,
} from "@/features/attendance/attendance-status";
import { ReadOnlyStatus, type ReadOnlyRowMode } from "@/features/attendance/read-only-status";
import { HTTP_STATUS_CONFLICT } from "@/lib/constants";
import { foldUnknownFieldErrors, NON_FIELD, resolveErrorMessage } from "@/lib/error-message";
import {
  ApiError,
  Services,
  type MarkStaffAttendanceInput,
  type StaffAttendanceRecord,
  type StaffRegisterEntry,
  type StaffRowDraft,
} from "@/services";
import { toShortTime } from "@/services/modules/periods/periods-helper";
import {
  MARKABLE_STAFF_STATUSES,
  STAFF_REMARKS_MAX_LENGTH,
  STAFF_STATUS_ABSENT,
} from "@/services/modules/staff-attendance/staff-attendance-constant";
import {
  canCheckOut,
  clearsSavedTimes,
  isMarkableStaffStatus,
  isSameStaffDraft,
  isStaffDraftChanged,
  rebaseStaffDraft,
  staffDraftFromRecord,
  toMarkStaffInput,
} from "@/services/modules/staff-attendance/staff-attendance-helper";

export interface StaffRegisterRowProps {
  entry: StaffRegisterEntry;
  /** `YYYY-MM-DD`: the register's date. */
  date: string;
  /** The date can't be marked (it is in the future): the row only shows what is saved. */
  readOnly: boolean;
  /** The row as the server wrote it, after a Save. */
  onSaved: (record: StaffAttendanceRecord) => void;
  /** The row locked since it loaded (a 409): the register reloads to show it read-only. */
  onLocked: () => void;
  onCheckOut: (record: StaffAttendanceRecord) => void;
  /** Set when the viewer may ask for a locked row to change (`attendance.correction.create`). */
  onRequestCorrection?: (record: StaffAttendanceRecord) => void;
}

type RowMode = "editable" | ReadOnlyRowMode;

/** A locked record is read-only whatever else holds; approved leave is shown, never marked. */
function rowMode(entry: StaffRegisterEntry, readOnly: boolean): RowMode {
  if (entry.record?.is_locked) return "locked";
  if (entry.on_leave) return "leave";
  return readOnly ? "readOnly" : "editable";
}

/**
 * One staff member on the staff register: name, employee number and department, then either the
 * status toggle with check-in and remarks and its own Save, or the saved status read-only (leave,
 * a locked row, a date that can't be marked yet). A checked-in, unlocked row offers Check out; a
 * locked one offers Request correction. The caller keys the row by date and staff member; when
 * the record changes under it (a save, a check-out, a reload), every field the viewer hasn't
 * edited takes the server's value and every unsaved edit stays.
 */
export function StaffRegisterRow({
  entry,
  date,
  readOnly,
  onSaved,
  onLocked,
  onCheckOut,
  onRequestCorrection,
}: StaffRegisterRowProps) {
  const t = useTranslations("attendance");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const { record } = entry;
  const name = entry.staff_name;
  const mode = rowMode(entry, readOnly);
  const saved = staffDraftFromRecord(record);
  // `base` is the record the draft was edited from.
  const [{ base, draft }, setState] = useState(() => ({ base: saved, draft: saved }));
  if (!isSameStaffDraft(base, saved)) {
    setState({ base: saved, draft: rebaseStaffDraft(draft, base, saved) });
  }
  const [issue, setIssue] = useState<string | null>(null);
  const issueId = `staff-issue-${entry.staff_id}`;

  const save = useMutation({
    mutationFn: (input: MarkStaffAttendanceInput) =>
      Services.staffAttendance.markStaffAttendance(input),
    onSuccess: (written) => {
      toast.success(t("staff.register.saved", { name }));
      onSaved(written);
    },
    onError: (error) => {
      // One message under the row: the server's own sentence (a holiday, a time out of order).
      setIssue(
        resolveErrorMessage(
          foldUnknownFieldErrors(error),
          tErrors,
          tCommon("submitFailed"),
          NON_FIELD,
        ),
      );
      if (error instanceof ApiError && error.status === HTTP_STATUS_CONFLICT) onLocked();
    },
  });
  const busy = save.isPending;

  function edit(patch: Partial<StaffRowDraft>) {
    setState((current) => ({ ...current, draft: { ...current.draft, ...patch } }));
    setIssue(null);
  }

  function handleSave() {
    const { status } = draft;
    if (status === "" || busy) return;
    setIssue(null);
    save.mutate(toMarkStaffInput(entry, date, { ...draft, status }));
  }

  return (
    <li className={cn("space-y-3 p-4", issue && "bg-destructive/5")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{name}</p>
          <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
            <span>{entry.employee_number}</span>
            {entry.department_name && <span>{entry.department_name}</span>}
          </p>
        </div>
        {mode === "editable" ? (
          <ToggleGroup
            type="single"
            size="sm"
            value={draft.status}
            disabled={busy}
            aria-label={t("register.statusFor", { name })}
            aria-describedby={issue ? issueId : undefined}
            className="flex-wrap"
            onValueChange={(value) => {
              // Radix clears a single toggle clicked twice; a picked row stays picked.
              if (isMarkableStaffStatus(value)) edit({ status: value });
            }}
          >
            {MARKABLE_STAFF_STATUSES.map((status) => {
              const Icon = ATTENDANCE_STATUS_ICON[status];
              return (
                <ToggleGroupItem
                  key={status}
                  value={status}
                  className={cn("border border-input", ATTENDANCE_STATUS_SELECTED_CLASS[status])}
                >
                  <Icon aria-hidden="true" />
                  {t(`status.${status}`)}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        ) : (
          <ReadOnlyStatus
            record={record}
            name={name}
            mode={mode}
            onRequestCorrection={onRequestCorrection}
          />
        )}
      </div>
      {mode === "editable" && (
        <div className="flex flex-wrap items-center gap-2">
          {/* An absent day has no times: its check-in is neither shown nor sent. */}
          {draft.status !== STAFF_STATUS_ABSENT && (
            <Input
              type="time"
              value={draft.checkInTime}
              disabled={busy}
              className="w-full sm:w-36"
              aria-label={t("register.checkInFor", { name })}
              onChange={(event) => {
                edit({ checkInTime: event.target.value });
              }}
            />
          )}
          <Input
            value={draft.remarks}
            maxLength={STAFF_REMARKS_MAX_LENGTH}
            disabled={busy}
            className="w-full sm:w-64"
            placeholder={t("correction.fields.remarks")}
            aria-label={t("register.remarksFor", { name })}
            onChange={(event) => {
              edit({ remarks: event.target.value });
            }}
          />
          <Button
            size="sm"
            disabled={busy || !isStaffDraftChanged(draft, record)}
            aria-label={t("staff.register.saveFor", { name })}
            onClick={handleSave}
          >
            {busy ? tCommon("saving") : tCommon("save")}
          </Button>
          {canCheckOut(record) && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              aria-label={t("staff.register.checkOutFor", { name })}
              onClick={() => {
                onCheckOut(record);
              }}
            >
              <LogOut aria-hidden="true" className="rtl:rotate-180" />
              {t("staff.register.checkOut")}
            </Button>
          )}
        </div>
      )}
      {mode === "editable" && clearsSavedTimes(draft, record) && (
        <p className="text-xs text-muted-foreground">{t("staff.register.absentClearsTimes")}</p>
      )}
      {record?.check_out_time && (
        <p className="text-xs text-muted-foreground">
          {t("staff.register.checkedOut", { time: toShortTime(record.check_out_time) })}
        </p>
      )}
      {issue && (
        <p id={issueId} role="alert" className="text-sm text-destructive">
          {issue}
        </p>
      )}
    </li>
  );
}
