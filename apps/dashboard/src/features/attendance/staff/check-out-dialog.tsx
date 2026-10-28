"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormControl, FormField, FormItem, FormLabel, FormMessage, Input } from "@schoolhub/ui";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { HTTP_STATUS_CONFLICT } from "@/lib/constants";
import { formatDate } from "@/lib/helpers";
import { ApiError, Services, type StaffAttendanceRecord } from "@/services";
import { toShortTime } from "@/services/modules/periods/periods-helper";
import { CHECK_OUT_ERROR_FIELDS } from "@/services/modules/staff-attendance/staff-attendance-constant";
import {
  createCheckOutFormSchema,
  type CheckOutFormValues,
} from "@/services/modules/staff-attendance/staff-attendance.schema";

export interface CheckOutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A checked-in, unlocked row (`canCheckOut`). */
  record: StaffAttendanceRecord;
  /** The row as the server wrote it: the departure, and its computed early-leave minutes. */
  onCheckedOut: (record: StaffAttendanceRecord) => void;
  /** The row locked since it loaded (a 409): the register reloads to show it read-only. */
  onLocked: () => void;
}

/**
 * Records when a checked-in staff member left (`:check-out`); the server works out how early
 * that was. The time must be later than the check-in (§11), checked here and by the server.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts blank.
 */
export function CheckOutDialog({
  open,
  onOpenChange,
  record,
  onCheckedOut,
  onLocked,
}: CheckOutDialogProps) {
  const t = useTranslations("attendance");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const checkInTime = record.check_in_time ? toShortTime(record.check_in_time) : "";

  const schema = useMemo(
    () =>
      createCheckOutFormSchema(
        {
          required: t("staff.checkOut.required"),
          notAfterCheckIn: t("staff.checkOut.notAfterCheckIn"),
        },
        checkInTime,
      ),
    [t, checkInTime],
  );
  const form = useForm<CheckOutFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { check_out_time: "" },
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: async (values: CheckOutFormValues) => {
      try {
        return await Services.staffAttendance.checkOutStaff(record.id, values.check_out_time);
      } catch (error) {
        if (error instanceof ApiError && error.status === HTTP_STATUS_CONFLICT) onLocked();
        throw error;
      }
    },
    knownFields: CHECK_OUT_ERROR_FIELDS,
    onSuccess: (saved) => {
      toast.success(t("staff.checkOut.done", { name: record.staff_name }));
      onCheckedOut(saved);
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t("staff.checkOut.title")}
      description={t("staff.checkOut.description", {
        name: record.staff_name,
        time: checkInTime,
        date: formatDate(record.attendance_date, locale),
      })}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={t("staff.checkOut.submitting")}
      submitLabel={t("staff.checkOut.submit")}
    >
      <FormField
        control={form.control}
        name="check_out_time"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("staff.checkOut.time")}</FormLabel>
            <FormControl>
              <Input type="time" min={checkInTime || undefined} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormDialogLayout>
  );
}
