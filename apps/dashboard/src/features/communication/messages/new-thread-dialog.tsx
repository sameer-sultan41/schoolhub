"use client";

import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Textarea,
} from "@schoolhub/ui";

import { AttachmentUploader, type UploadedAttachment } from "@/components/attachment-uploader";
import { FormDialogLayout } from "@/components/form-dialog-layout";
import { FormSelectField } from "@/components/form-select-field";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { Services } from "@/services";
import {
  THREAD_ATTACHMENT_MAX_FILES,
  THREAD_ATTACHMENT_PURPOSE,
} from "@/services/modules/files/files-constant";
import {
  MESSAGE_BODY_MAX_LENGTH,
  NEW_THREAD_TYPES,
  THREAD_SUBJECT_MAX_LENGTH,
} from "@/services/modules/message-threads/message-threads-constant";

import {
  buildNewThreadInput,
  createNewThreadSchema,
  NEW_THREAD_DEFAULTS,
  type NewThreadFormValues,
} from "./new-thread-form-schema";
import { RecipientPicker } from "./recipient-picker";
import { ChildStudentSelect } from "./child-student-select";
import { StudentPicker, type PickedStudent } from "@/components/student-picker";
import { useInvalidateThreads } from "./use-invalidate-threads";

export interface NewThreadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new thread's id, so the screen can open it. */
  onCreated: (threadId: string) => void;
  /** The parent portal: the guardian's own children are the only choice, and the thread is
   * always a guardian-school one, so there is no type or recipient picker. */
  students?: readonly PickedStudent[];
  /** The parent portal: the first message can carry files. */
  allowAttachments?: boolean;
}

/**
 * Starts a conversation with its first message. Mounted by the screen only while open, so each
 * open is a fresh form.
 */
export function NewThreadDialog({
  open,
  onOpenChange,
  onCreated,
  students,
  allowAttachments = false,
}: NewThreadDialogProps) {
  const t = useTranslations("communication.messages.newThread");
  const invalidate = useInvalidateThreads();
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const schema = useMemo(
    () =>
      createNewThreadSchema({
        subjectRequired: t("errors.subjectRequired"),
        subjectTooLong: t("errors.subjectTooLong", { max: THREAD_SUBJECT_MAX_LENGTH }),
        bodyRequired: t("errors.bodyRequired"),
        bodyTooLong: t("errors.bodyTooLong", { max: MESSAGE_BODY_MAX_LENGTH }),
        studentRequired: t("errors.studentRequired"),
        internalNeedsOne: t("errors.internalNeedsOne"),
        groupNeedsTwo: t("errors.groupNeedsTwo"),
      }),
    [t],
  );
  const form = useForm<NewThreadFormValues>({
    resolver: zodResolver(schema),
    defaultValues: NEW_THREAD_DEFAULTS,
  });
  const threadType = form.watch("thread_type");

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values) =>
      Services.messageThreads.createThread({
        ...buildNewThreadInput(values),
        ...(attachments.length > 0 ? { attachments: attachments.map((item) => item.id) } : {}),
      }),
    knownFields: ["subject", "body", "thread_type"],
    onSuccess: (thread) => {
      invalidate();
      onCreated(thread.id);
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
      submitDisabled={isUploading}
    >
      {students === undefined && (
        <FormSelectField
          form={form}
          name="thread_type"
          label={t("type")}
          placeholder={t("type")}
          options={NEW_THREAD_TYPES.map((type) => ({ id: type, name: t(`types.${type}`) }))}
        />
      )}
      {threadType === "guardian_school" ? (
        <FormField
          control={form.control}
          name="student"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("student")}</FormLabel>
              {students === undefined ? (
                <StudentPicker value={field.value} onChange={field.onChange} />
              ) : (
                <ChildStudentSelect
                  students={students}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
              <FormMessage />
            </FormItem>
          )}
        />
      ) : (
        <FormField
          control={form.control}
          name="participants"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("recipients")}</FormLabel>
              <RecipientPicker
                value={field.value}
                onChange={field.onChange}
                multiple={threadType === "group"}
              />
              <FormMessage />
            </FormItem>
          )}
        />
      )}
      <FormField
        control={form.control}
        name="subject"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("subject")}</FormLabel>
            <FormControl>
              <Input maxLength={THREAD_SUBJECT_MAX_LENGTH} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="body"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("body")}</FormLabel>
            <FormControl>
              <Textarea rows={4} maxLength={MESSAGE_BODY_MAX_LENGTH} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      {allowAttachments && (
        <AttachmentUploader
          purpose={THREAD_ATTACHMENT_PURPOSE}
          label={t("attachments")}
          value={attachments}
          onChange={setAttachments}
          onUploadingChange={setIsUploading}
          multiple
          maxFiles={THREAD_ATTACHMENT_MAX_FILES}
        />
      )}
    </FormDialogLayout>
  );
}
