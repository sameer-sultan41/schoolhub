"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { Alert, Button, Form } from "@schoolhub/ui";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { useIsDesktopShell } from "@/hooks/use-is-desktop-shell";
import { resolveErrorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import type { StudentTransferRecord } from "@/services/modules/student-transfers/student-transfers-type";
import { ClassSectionFields } from "./class-section-fields";

interface CompleteTransferFormState {
  section_id: string;
}

export interface CompleteTransferDialogProps {
  transfer: StudentTransferRecord;
  /** The student's current active enrollment's class, or `null` when there is none —
   * `complete_transfer` silently skips section reassignment (no error) in that case, so
   * this dialog shows a plain confirm instead of a picker whose value the server would
   * ignore. Never passed for an `incoming` transfer — the caller (the orchestrator tab)
   * never renders this dialog for one at all. */
  currentEnrollmentClass: { id: string; name: string } | null;
  /** Gates `students.transfer.create` (the same key `request`/`complete` both reuse — not
   * `students.transfer.approve`, confirmed from the real view's
   * `required_permission_map`). */
  canComplete: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Every hook below runs unconditionally, on every render, regardless of `canComplete` or
 * `transfer.transfer_type` — only the returned JSX branches on those. An earlier draft
 * returned early for `!canComplete` and for `transfer_type === "incoming"` before any hook
 * ran, which breaks the Rules of Hooks; the `canComplete` check here is the first
 * *statement*, not the first hook.
 */
export function CompleteTransferDialog({
  transfer,
  currentEnrollmentClass,
  canComplete,
  open,
  onOpenChange,
}: CompleteTransferDialogProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktopShell();

  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<CompleteTransferFormState>({ defaultValues: { section_id: "" } });

  const mutation = useMutation({
    mutationFn: (payload: { sectionId?: string }) =>
      Services.studentTransfers.completeTransfer(transfer.id, payload, idempotencyKey),
    onSuccess: () => {
      // Both whole modules, not narrower keys: completion changes the transfers list, the
      // history timeline, the student's own detail (campus may have changed) and the
      // directory list's filters — the same broad-invalidation precedent
      // `withdraw-student-dialog.tsx` already uses for a lifecycle-changing action.
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("student-transfers") });
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("students") });
      onOpenChange(false);
    },
    onError: (error) => {
      setFormError(resolveErrorMessage(error, tErrors, t("form.submitFailed"), "non_field"));
    },
  });

  if (!canComplete) {
    return null;
  }

  const needsSectionPicker =
    transfer.transfer_type === "inter_campus" && currentEnrollmentClass !== null;

  if (!needsSectionPicker) {
    return (
      <ResponsiveAlertDialog
        open={open}
        onOpenChange={onOpenChange}
        title={t("transfers.complete")}
        description={
          transfer.transfer_type === "inter_campus"
            ? t("transfers.completeNoActiveEnrollmentDescription")
            : t("transfers.completeDescription")
        }
        confirmLabel={t("transfers.complete")}
        isPending={mutation.isPending}
        error={formError ?? undefined}
        onConfirm={() => {
          mutation.mutate({});
        }}
      />
    );
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} nested>
      <ResponsiveDialogContent className="max-w-lg" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("transfers.complete")}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <Form {...form}>
          <ResponsiveDialogBody
            className={
              isDesktop
                ? "max-h-[65vh] space-y-4 overflow-y-auto pe-1"
                : "space-y-4 overflow-y-auto"
            }
          >
            {formError && <Alert variant="destructive">{formError}</Alert>}
            <ClassSectionFields
              form={form}
              // `complete_transfer` validates against the destination campus, not the
              // student's current one — confirmed `assert_section_belongs_to_class`
              // checks the section against the existing enrollment's class, and
              // `to_campus_id` is always populated for an inter_campus transfer by
              // `assert_transfer_campus_fields`.
              campusId={transfer.to_campus_id as string}
              locked
              currentClass={currentEnrollmentClass}
              sectionFieldName="section_id"
            />
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              type="button"
              disabled={!form.watch("section_id") || mutation.isPending}
              isLoading={mutation.isPending}
              loadingLabel={t("form.submitting")}
              onClick={() => {
                mutation.mutate({ sectionId: form.getValues("section_id") });
              }}
            >
              {t("transfers.complete")}
            </Button>
          </ResponsiveDialogFooter>
        </Form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
