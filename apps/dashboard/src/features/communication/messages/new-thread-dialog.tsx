"use client";

import { useMemo } from "react";
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

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { FormSelectField } from "@/components/form-select-field";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services } from "@/services";
import {
  MESSAGE_BODY_MAX_LENGTH,
  MESSAGE_THREADS_QUERY_MODULE,
  THREAD_SUBJECT_MAX_LENGTH,
} from "@/services/modules/message-threads/message-threads-constant";

import {
  buildNewThreadInput,
  createNewThreadSchema,
  NEW_THREAD_DEFAULTS,
  NEW_THREAD_TYPES,
  type NewThreadFormValues,
} from "./new-thread-form-schema";
import { RecipientPicker } from "./recipient-picker";
import { StudentPicker } from "./student-picker";

export interface NewThreadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new thread's id, so the screen can open it. */
  onCreated: (threadId: string) => void;
}

/**
 * Starts a conversation with its first message. Mounted by the screen only while open, so each
 * open is a fresh form.
 */
export function NewThreadDialog({ open, onOpenChange, onCreated }: NewThreadDialogProps) {
  const t = useTranslations("communication.messages.newThread");
  const invalidate = useInvalidateModule(MESSAGE_THREADS_QUERY_MODULE);

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
    mutationFn: (values) => Services.messageThreads.createThread(buildNewThreadInput(values)),
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
    >
      <FormSelectField
        form={form}
        name="thread_type"
        label={t("type")}
        placeholder={t("type")}
        options={NEW_THREAD_TYPES.map((type) => ({ id: type, name: t(`types.${type}`) }))}
      />
      {threadType === "guardian_school" ? (
        <FormField
          control={form.control}
          name="student"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("student")}</FormLabel>
              <StudentPicker value={field.value} onChange={field.onChange} />
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
    </FormDialogLayout>
  );
}
