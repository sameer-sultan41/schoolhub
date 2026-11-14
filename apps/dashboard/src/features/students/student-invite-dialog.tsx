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
import type { PortalStatus } from "@/services/modules/students/students-type";
import type { PortalInviteTarget, usePortalInvite } from "./use-portal-invite";

export interface StudentInviteDialogProps {
  target: PortalInviteTarget;
  isResend: boolean;
  /** Picks the hint: a pending invite is re-sent to the address typed here; an `inactive`
   * account uses it only if nobody ever signed in to it. */
  portalStatus: PortalStatus;
  invite: ReturnType<typeof usePortalInvite>;
  onOpenChange: (open: boolean) => void;
}

/** The server's reason under `email` (a malformed or refused address), if it gave one. */
function emailIssueOf(error: unknown): string | undefined {
  return error instanceof ApiError ? error.fieldErrors()["email"] : undefined;
}

/** The hint under the title: where the server sends the invitation for this status. */
function emailHintKey(portalStatus: PortalStatus) {
  if (portalStatus === "none") return "studentEmailHint";
  if (portalStatus === "inactive") return "inactiveAccountEmailHint";
  return "pendingAccountEmailHint";
}

/**
 * Asks for the student's email (a student has no email on file). A resend to an account nobody
 * has activated goes to the address typed here, so it corrects a typo; an account that was once
 * active keeps its own. Mounted only while open, so each open is a fresh form.
 */
export function StudentInviteDialog({
  target,
  isResend,
  portalStatus,
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
      description={t(emailHintKey(portalStatus))}
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
