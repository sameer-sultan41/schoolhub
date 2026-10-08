"use client";

import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import {
  Alert,
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@schoolhub/ui";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { useIsDesktopShell } from "@/hooks/use-is-desktop-shell";
import { useGuardedSubmit, useSubmitGuard } from "@/hooks/use-submit-guard";
import { applyServerFieldErrors } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  enrollFormSchema,
  type EnrollFormValues,
} from "@/services/modules/students/students.schema";
import { ClassSectionFields } from "./class-section-fields";

/** Sessions no longer open for new enrollments — excluded from the picker so a caller
 * can't choose a session the server will reject. */
const CLOSED_SESSION_STATUSES = new Set(["closed", "archived"]);

export interface EnrollDialogProps {
  studentId: string;
  campusId: string;
  /** Gates `students.student.update` — distinct from the action's own permission,
   * `students.enrollment.enroll` (checked by the caller before this dialog is even
   * mounted). A caller can enroll without being able to override capacity. */
  canOverrideCapacity: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Mounting contract matches `GuardianFormDialog`: the caller mounts this only while
 * `open` is true (or keeps it mounted and toggles `open` — either is fine here, since this
 * form has no per-instance state that needs resetting between opens the way
 * `WithdrawStudentDialog`'s idempotency-key cache does; a fresh `crypto.randomUUID()` per
 * render of `EnrollBody` would be wrong, so the key is generated once via `useState`'s
 * lazy initializer, which only re-runs on remount — mount this with a `key` tied to the
 * student if ever reused across students in one parent). */
export function EnrollDialog({
  studentId,
  campusId,
  canOverrideCapacity,
  open,
  onOpenChange,
}: EnrollDialogProps) {
  const tCommon = useTranslations("common");
  const t = useTranslations("students");
  const isMobile = !useIsDesktopShell();

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} nested>
      <ResponsiveDialogContent className="max-w-lg" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("enrollment.enroll")}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {open ? (
          <EnrollBody
            studentId={studentId}
            campusId={campusId}
            canOverrideCapacity={canOverrideCapacity}
            isMobile={isMobile}
            onOpenChange={onOpenChange}
          />
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

interface EnrollBodyProps {
  studentId: string;
  campusId: string;
  canOverrideCapacity: boolean;
  isMobile: boolean;
  onOpenChange: (open: boolean) => void;
}

function EnrollBody({
  studentId,
  campusId,
  canOverrideCapacity,
  isMobile,
  onOpenChange,
}: EnrollBodyProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();

  const submitGuard = useSubmitGuard();
  const [formError, setFormError] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const sessionsQuery = useQuery({
    queryKey: queryKeys.list("school-organization", "academic-sessions"),
    queryFn: () => Services.schoolOrganization.fetchAcademicSessions(),
  });
  const openSessions = useMemo(
    () =>
      (sessionsQuery.data ?? []).filter((session) => !CLOSED_SESSION_STATUSES.has(session.status)),
    [sessionsQuery.data],
  );

  const form = useForm<EnrollFormValues>({
    resolver: zodResolver(enrollFormSchema),
    defaultValues: {
      academic_session_id: "",
      class_id: "",
      section_id: "",
      enrollment_date: "",
      roll_number: "",
      capacity_override_reason: "",
    },
  });

  const mutation = useMutation({
    mutationFn: (values: EnrollFormValues) =>
      Services.students.enrollStudent(
        studentId,
        {
          academicSessionId: values.academic_session_id,
          classId: values.class_id,
          sectionId: values.section_id,
          enrollmentDate: values.enrollment_date,
          ...(values.roll_number ? { rollNumber: values.roll_number } : {}),
          ...(values.capacity_override_reason
            ? { capacityOverrideReason: values.capacity_override_reason }
            : {}),
        },
        idempotencyKey,
      ),
    onSuccess: () => {
      // The whole `students` module, not just the `history` key — enrolling also changes
      // which directory filters now match this student, the same reasoning
      // `withdraw-student-dialog.tsx`'s own invalidation already uses for a
      // lifecycle-changing action.
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("students") });
      onOpenChange(false);
    },
    onError: (error) => {
      applyServerFieldErrors({
        error,
        form,
        knownFields: Object.keys(enrollFormSchema.shape),
        tErrors,
        fallback: t("form.submitFailed"),
        setFormError,
      });
    },
  });

  const handleSubmit = useGuardedSubmit(
    form,
    submitGuard,
    (values) =>
      new Promise<void>((resolve) => {
        mutation.mutate(values, {
          onSettled: () => {
            resolve();
          },
        });
      }),
  );

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={handleSubmit}
        className={isMobile ? "flex min-h-0 grow flex-col" : undefined}
      >
        <ResponsiveDialogBody
          className={
            isMobile ? "space-y-4 overflow-y-auto" : "max-h-[65vh] space-y-4 overflow-y-auto pe-1"
          }
        >
          {formError && <Alert variant="destructive">{formError}</Alert>}
          <FormField
            control={form.control}
            name="academic_session_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("enrollment.fields.academicSession")}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          sessionsQuery.isPending
                            ? tCommon("loading")
                            : t("enrollment.fields.selectSession")
                        }
                      />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {openSessions.map((session) => (
                      <SelectItem key={session.id} value={session.id}>
                        {session.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <ClassSectionFields
            form={form}
            campusId={campusId}
            locked={false}
            classFieldName="class_id"
            sectionFieldName="section_id"
          />
          <FormField
            control={form.control}
            name="enrollment_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("enrollment.fields.enrollmentDate")}</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="roll_number"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("enrollment.fields.rollNumber")}</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {canOverrideCapacity && (
            <FormField
              control={form.control}
              name="capacity_override_reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("enrollment.fields.overrideReason")}</FormLabel>
                  <FormControl>
                    <Textarea {...field} />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    {t("enrollment.fields.overrideReasonHint")}
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
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
          <Button type="submit" isLoading={mutation.isPending} loadingLabel={t("form.submitting")}>
            {t("enrollment.enroll")}
          </Button>
        </ResponsiveDialogFooter>
      </form>
    </Form>
  );
}
