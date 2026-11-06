"use client";

import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Skeleton,
  Textarea,
} from "@schoolhub/ui";

import { AttachmentUploader, type UploadedAttachment } from "@/components/attachment-uploader";
import { FormDialogLayout } from "@/components/form-dialog-layout";
import { FormSelectField } from "@/components/form-select-field";
import { enumLabel } from "@/features/portal/enum-label";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import { LEAVE_ATTACHMENT_PURPOSE } from "@/services/modules/files/files-constant";
import {
  LEAVE_DAY_PARTS,
  LEAVE_DEFAULT_DAY_PART,
  LEAVE_REASON_MAX_LENGTH,
  LEAVE_TYPES_LIST_RESOURCE,
  LEAVE_TYPES_QUERY_MODULE,
} from "@/services/modules/leave-requests/leave-requests-constant";
import {
  createNewLeaveSchema,
  type NewLeaveFormValues,
} from "@/services/modules/leave-requests/leave-requests.schema";
import { LEAVE_DAY_PART_LABEL_KEY } from "./leave-labels";
import { useInvalidatePortalLeave } from "./use-invalidate-portal-leave";

const DEFAULTS: NewLeaveFormValues = {
  leave_type_id: "",
  start_date: "",
  end_date: "",
  day_part: LEAVE_DEFAULT_DAY_PART,
  reason: "",
  attachment_file_id: "",
};

/** The fields a server refusal can name under an input (`student_id` has none: the child is
 * fixed by the page, so it folds into the form's own message). */
const KNOWN_FIELDS = [
  "leave_type_id",
  "start_date",
  "end_date",
  "day_part",
  "reason",
  "attachment_file_id",
] as const;

export interface NewLeaveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
}

/**
 * A guardian's leave request for one child: type, dates, half day, reason and, when the type
 * asks for one, an attachment (a medical note) uploaded first and sent by id. A server 422 shows
 * under the field it names.
 *
 * Mounting contract: the caller mounts this only while it is open, so each open is a fresh form.
 */
export function NewLeaveDialog({ open, onOpenChange, studentId }: NewLeaveDialogProps) {
  const t = useTranslations("portal.leave.new");
  const tLeave = useTranslations("portal.leave");
  const invalidate = useInvalidatePortalLeave();
  const [attachment, setAttachment] = useState<UploadedAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  // Shares the leave-type cache entry the staff queue reads; only active, student-usable types.
  const types = useQuery({
    queryKey: queryKeys.list(LEAVE_TYPES_QUERY_MODULE, LEAVE_TYPES_LIST_RESOURCE),
    queryFn: () => Services.leaveRequests.fetchLeaveTypes(),
    select: (all) => all.filter((type) => type.is_active && type.applies_to !== "staff"),
  });

  const schema = useMemo(
    () =>
      createNewLeaveSchema({
        typeRequired: t("errors.typeRequired"),
        startRequired: t("errors.startRequired"),
        endRequired: t("errors.endRequired"),
        endBeforeStart: t("errors.endBeforeStart"),
        halfDaySingleDay: t("errors.halfDaySingleDay"),
        reasonRequired: t("errors.reasonRequired"),
        reasonTooLong: t("errors.reasonTooLong", { max: LEAVE_REASON_MAX_LENGTH }),
        attachmentRequired: t("errors.attachmentRequired"),
        requiresAttachment: (id) =>
          types.data?.find((type) => type.id === id)?.requires_attachment ?? false,
      }),
    [t, types.data],
  );
  const form = useForm<NewLeaveFormValues>({
    resolver: zodResolver(schema),
    defaultValues: DEFAULTS,
  });
  const leaveTypeId = useWatch({ control: form.control, name: "leave_type_id" });
  const requiresAttachment =
    types.data?.find((type) => type.id === leaveTypeId)?.requires_attachment ?? false;

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values) =>
      Services.leaveRequests.createLeave({
        studentId,
        leaveTypeId: values.leave_type_id,
        startDate: values.start_date,
        endDate: values.end_date,
        dayPart: values.day_part,
        reason: values.reason.trim(),
        attachmentFileId: values.attachment_file_id || undefined,
      }),
    knownFields: KNOWN_FIELDS,
    onSuccess: () => {
      invalidate();
      toast.success(t("done"));
      onOpenChange(false);
    },
    fallbackMessage: t("failed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={t("submitting")}
      submitLabel={t("submit")}
      submitDisabled={isUploading || types.isPending}
    >
      {types.isPending ? (
        <Skeleton className="h-9 w-full" />
      ) : (
        <FormSelectField
          form={form}
          name="leave_type_id"
          label={t("type")}
          placeholder={t("typePlaceholder")}
          options={types.data ?? []}
          disabled={types.isError}
          description={types.isError ? t("typesFailed") : undefined}
          onPick={() => {
            // A type that needs no document leaves nothing attached from the one before.
            setAttachment([]);
            form.setValue("attachment_file_id", "");
          }}
        />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="start_date"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("startDate")}</FormLabel>
              <FormControl>
                <Input type="date" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="end_date"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("endDate")}</FormLabel>
              <FormControl>
                <Input type="date" min={form.getValues("start_date") || undefined} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <FormSelectField
        form={form}
        name="day_part"
        label={t("dayPart")}
        placeholder={t("dayPart")}
        options={LEAVE_DAY_PARTS.map((part) => ({
          id: part,
          name: enumLabel(tLeave, LEAVE_DAY_PART_LABEL_KEY, part),
        }))}
        description={t("dayPartHint")}
      />
      <FormField
        control={form.control}
        name="reason"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("reason")}</FormLabel>
            <FormControl>
              <Textarea rows={3} maxLength={LEAVE_REASON_MAX_LENGTH} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      {requiresAttachment && (
        <FormField
          control={form.control}
          name="attachment_file_id"
          render={() => (
            <FormItem>
              <AttachmentUploader
                purpose={LEAVE_ATTACHMENT_PURPOSE}
                label={t("attachment")}
                value={attachment}
                onChange={(next) => {
                  setAttachment(next);
                  form.setValue("attachment_file_id", next[0]?.id ?? "", {
                    shouldValidate: form.formState.isSubmitted,
                  });
                }}
                onUploadingChange={setIsUploading}
              />
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </FormDialogLayout>
  );
}
