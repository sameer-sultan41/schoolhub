"use client";

import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from "@schoolhub/ui";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { ApiError } from "@/services";
import {
  createStudentInviteSchema,
  type StudentInviteValues,
} from "@/services/modules/students/students.schema";
import type { PortalInviteTarget, usePortalInvite } from "./use-portal-invite";

export interface StudentInviteDialogProps {
  target: PortalInviteTarget;
  isResend: boolean;
  /** The student already has an account (`inactive` or a pending invite): the server sends to
   * its address and does not use the one typed here. */
  hasAccount: boolean;
  invite: ReturnType<typeof usePortalInvite>;
  onOpenChange: (open: boolean) => void;
}

/** The server's reason under `email` (a malformed or refused address), if it gave one. */
function emailIssueOf(error: unknown): string | undefined {
  return error instanceof ApiError ? error.fieldErrors()["email"] : undefined;
}

/**
 * Asks for the student's email (a student has no email on file). The API requires it on a
 * resend too but sends the resend to the account's own address, which the copy says.
 * Mounted only while open, so each open is a fresh form.
 */
export function StudentInviteDialog({
  target,
  isResend,
  hasAccount,
  invite,
  onOpenChange,
}: StudentInviteDialogProps) {
  const t = useTranslations("students.portal");
  const [formError, setFormError] = useState<string | null>(null);
  const schema = useMemo(() => createStudentInviteSchema({ invalidEmail: t("invalidEmail") }), [t]);
  const form = useForm<StudentInviteValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  return (
    <FormDialogLayout
      open
      onOpenChange={onOpenChange}
      title={t(isResend ? "resendTitle" : "inviteTitle", { name: target.name })}
      description={t(hasAccount ? "existingAccountEmailHint" : "studentEmailHint")}
      form={form}
      formError={formError}
      isPending={invite.mutation.isPending}
      submitLabel={t("send")}
      submittingLabel={t("sending")}
      onSubmit={(event) => {
        form
          .handleSubmit((values) => {
            setFormError(null);
            invite.mutation.mutate(values.email, {
              onSuccess: () => {
                onOpenChange(false);
              },
              onError: (error) => {
                const emailIssue = emailIssueOf(error);
                if (emailIssue) {
                  form.setError("email", { type: "server", message: emailIssue });
                } else {
                  setFormError(invite.describeError(error));
                }
              },
            });
          })(event)
          .catch((error: unknown) => {
            console.error("Unexpected error while submitting the invite form:", error);
          });
      }}
    >
      <FormField
        control={form.control}
        name="email"
        render={({ field }) => (
          <FormItem>
            <FormLabel required>{t("studentEmail")}</FormLabel>
            <FormControl required>
              <Input {...field} type="email" autoComplete="off" autoFocus />
            </FormControl>
            <FormDescription>{t("studentEmailNote")}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormDialogLayout>
  );
}
