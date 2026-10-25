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
  type StudentAttendanceRecord,
} from "@/services";
import {
  CORRECTION_ERROR_FIELDS,
  CORRECTION_REASON_MAX_LENGTH,
  CORRECTIONS_QUERY_MODULE,
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
  ATTENDANCE_REMARKS_MAX_LENGTH,
  MARKABLE_STATUSES,
} from "@/services/modules/student-attendance/student-attendance-constant";

/**
 * The row a correction is asked for. Only a student row today; a staff row (PR C) joins as its
 * own `kind`, with its own record and service call.
 */
export type CorrectionTarget = { kind: "student"; record: StudentAttendanceRecord };

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
 * Asks for a locked row to change: a new status (never `on_leave`), times, remarks and a
 * mandatory reason. An approver makes the change. Submit waits until a value differs from the
 * record, as the server refuses a proposal that matches it (§11); only changed values are sent,
 * and a server error shows under the field it names.
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
    defaultValues: recordToCorrectionValues(record),
  });
  const newValues = useWatch({ control: form.control, name: "new_values" });
  const hasChange =
    Object.keys(buildCorrectionNewValues({ new_values: newValues, reason: "" }, record)).length > 0;

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: CorrectionFormValues) =>
      Services.attendanceCorrections.requestCorrection({
        studentAttendanceId: record.id,
        newValues: buildCorrectionNewValues(values, record),
        reason: values.reason.trim(),
      }),
    knownFields: CORRECTION_ERROR_FIELDS,
    onSuccess: (correction) => {
      // The request joins the Corrections queue.
      void queryClient.invalidateQueries({ queryKey: queryKeys.module(CORRECTIONS_QUERY_MODULE) });
      toast.success(t("correction.requested"));
      onRequested?.(correction);
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  const statusOptions = MARKABLE_STATUSES.map((status) => ({
    id: status,
    name: t(`status.${status}`),
  }));

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t("correction.title")}
      description={t("correction.description", {
        name: record.student_name,
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
                  <Input type="time" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ))}
      </div>
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
