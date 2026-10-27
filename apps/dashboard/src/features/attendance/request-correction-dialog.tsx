"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Textarea,
} from "@schoolhub/ui";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { FormSelectField } from "@/components/form-select-field";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { formatDate } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import {
  Services,
  type AttendanceCorrectionRecord,
  type CorrectionNewValues,
  type MarkableStatus,
  type RequestCorrectionInput,
  type StaffAttendanceRecord,
  type StudentAttendanceRecord,
} from "@/services";
import {
  CORRECTION_CHANGE_FIELDS,
  CORRECTION_ERROR_FIELDS,
  CORRECTION_REASON_MAX_LENGTH,
  CORRECTIONS_QUERY_MODULE,
  STAFF_CORRECTION_CHANGE_FIELDS,
  STAFF_CORRECTION_ERROR_FIELDS,
} from "@/services/modules/attendance-corrections/attendance-corrections-constant";
import {
  buildCorrectionNewValues,
  recordToCorrectionValues,
} from "@/services/modules/attendance-corrections/attendance-corrections-helper";
import {
  createCorrectionFormSchema,
  type CorrectionFormValues,
} from "@/services/modules/attendance-corrections/attendance-corrections.schema";
import {
  MARKABLE_STAFF_STATUSES,
  STAFF_STATUS_ABSENT,
} from "@/services/modules/staff-attendance/staff-attendance-constant";
import { isMarkableStaffStatus } from "@/services/modules/staff-attendance/staff-attendance-helper";
import {
  ATTENDANCE_REMARKS_MAX_LENGTH,
  MARKABLE_STATUSES,
} from "@/services/modules/student-attendance/student-attendance-constant";
import { isMarkableStatus } from "@/services/modules/student-attendance/student-attendance-helper";

/** The row a correction is asked for: a student's, or a staff member's (which has no remarks
 * to correct, and the staff register's statuses). */
export type CorrectionTarget =
  | { kind: "student"; record: StudentAttendanceRecord }
  | { kind: "staff"; record: StaffAttendanceRecord };

/** What differs between the two kinds of row. */
interface TargetRules {
  name: string;
  statuses: readonly MarkableStatus[];
  isSettable: (status: string) => status is MarkableStatus;
  fields: readonly (keyof CorrectionNewValues)[];
  errorFields: readonly string[];
  toInput: (newValues: CorrectionNewValues, reason: string) => RequestCorrectionInput;
}

function targetRules(target: CorrectionTarget): TargetRules {
  if (target.kind === "staff") {
    const { record } = target;
    return {
      name: record.staff_name,
      statuses: MARKABLE_STAFF_STATUSES,
      isSettable: isMarkableStaffStatus,
      fields: STAFF_CORRECTION_CHANGE_FIELDS,
      errorFields: STAFF_CORRECTION_ERROR_FIELDS,
      toInput: (newValues, reason) => ({
        staffAttendanceId: record.id,
        newValues,
        reason,
      }),
    };
  }
  const { record } = target;
  return {
    name: record.student_name,
    statuses: MARKABLE_STATUSES,
    isSettable: isMarkableStatus,
    fields: CORRECTION_CHANGE_FIELDS,
    errorFields: CORRECTION_ERROR_FIELDS,
    toInput: (newValues, reason) => ({
      studentAttendanceId: record.id,
      newValues,
      reason,
    }),
  };
}

export interface RequestCorrectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: CorrectionTarget;
  onRequested?: (correction: AttendanceCorrectionRecord) => void;
}

/** The time inputs, in display order. */
const TIME_FIELDS = [
  ["new_values.check_in_time", "correction.fields.checkIn"],
  ["new_values.check_out_time", "correction.fields.checkOut"],
] as const;

/**
 * Asks for a locked row to change: a new status (never `on_leave`), times, remarks (a student's
 * row only) and a mandatory reason. An approver makes the change. Submit waits until a value
 * differs from the record, as the server refuses a proposal that matches it (§11); only changed
 * values are sent, and a server error shows under the field it names.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts from
 * the target's current values.
 */
export function RequestCorrectionDialog({
  open,
  onOpenChange,
  target,
  onRequested,
}: RequestCorrectionDialogProps) {
  const t = useTranslations("attendance");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { record } = target;
  const rules = targetRules(target);
  const hasRemarks = rules.fields.includes("remarks");

  const schema = useMemo(
    () =>
      createCorrectionFormSchema({
        reasonRequired: t("correction.reasonRequired"),
        reasonTooLong: t("correction.reasonTooLong"),
        remarksTooLong: t("correction.remarksTooLong"),
      }),
    [t],
  );
  const form = useForm<CorrectionFormValues>({
    resolver: zodResolver(schema),
    defaultValues: recordToCorrectionValues(record, rules.isSettable),
  });
  const newValues = useWatch({ control: form.control, name: "new_values" });
  // A staff day marked absent has no times, as on the register: the server counts no minutes.
  const timesCleared = target.kind === "staff" && newValues.status === STAFF_STATUS_ABSENT;
  const clearTimesIfAbsent = (status: string) => {
    if (target.kind !== "staff" || status !== STAFF_STATUS_ABSENT) return;
    for (const [name] of TIME_FIELDS) form.setValue(name, "", { shouldDirty: true });
  };
  const hasChange =
    Object.keys(
      buildCorrectionNewValues({ new_values: newValues, reason: "" }, record, rules.fields),
    ).length > 0;

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: CorrectionFormValues) =>
      Services.attendanceCorrections.requestCorrection(
        rules.toInput(buildCorrectionNewValues(values, record, rules.fields), values.reason.trim()),
      ),
    knownFields: rules.errorFields,
    onSuccess: (correction) => {
      // The request joins the Corrections queue.
      void queryClient.invalidateQueries({ queryKey: queryKeys.module(CORRECTIONS_QUERY_MODULE) });
      toast.success(t("correction.requested"));
      onRequested?.(correction);
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  const statusOptions = rules.statuses.map((status) => ({
    id: status,
    name: t(`status.${status}`),
  }));

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t("correction.title")}
      description={t("correction.description", {
        name: rules.name,
        date: formatDate(record.attendance_date, locale),
      })}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={t("correction.submitting")}
      submitLabel={t("correction.submit")}
      submitDisabled={!hasChange}
    >
      <FormSelectField
        form={form}
        name="new_values.status"
        label={t("correction.fields.status")}
        placeholder={t("correction.fields.statusPlaceholder")}
        options={statusOptions}
        onPick={clearTimesIfAbsent}
        description={timesCleared ? t("correction.absentClearsTimes") : undefined}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {TIME_FIELDS.map(([name, labelKey]) => (
          <FormField
            key={name}
            control={form.control}
            name={name}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t(labelKey)}</FormLabel>
                <FormControl>
                  <Input type="time" {...field} disabled={timesCleared} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ))}
      </div>
      {hasRemarks && (
        <FormField
          control={form.control}
          name="new_values.remarks"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("correction.fields.remarks")}</FormLabel>
              <FormControl>
                <Input maxLength={ATTENDANCE_REMARKS_MAX_LENGTH} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
      <FormField
        control={form.control}
        name="reason"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("correction.fields.reason")}</FormLabel>
            <FormControl>
              <Textarea maxLength={CORRECTION_REASON_MAX_LENGTH} {...field} />
            </FormControl>
            <FormDescription>{t("correction.fields.reasonHint")}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      {!hasChange && <p className="text-sm text-muted-foreground">{t("correction.unchanged")}</p>}
    </FormDialogLayout>
  );
}
