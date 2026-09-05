"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ApiError } from "@schoolhub/api-client";
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Form,
  FormControl,
  FormDescription,
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
} from "@schoolhub/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { ApiErrorAlert, unhandledEnvelopeError } from "@/features/academics/academics-error-alert";
import type {
  AllocationLoadWarning,
  TeacherAllocationRecord,
} from "@/features/academics/academics-types";
import { mapAllocationFieldErrors } from "@/features/academics/allocation-map-field-errors";
import {
  allocationSchema,
  type AllocationFormValues,
} from "@/features/academics/allocation-schema";
import {
  useSections,
  useSubjects,
  useTeachingStaff,
} from "@/features/academics/use-academics-reference-data";
import { useAcademicSessions, useClasses } from "@/features/students/use-reference-data";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

const EMPTY_VALUES: AllocationFormValues = {
  academic_session_id: "",
  section_id: "",
  subject_id: "",
  staff_id: "",
  is_primary: true,
  weekly_periods: "",
  effective_from: "",
};

/**
 * Assign a teacher to a (session, section, subject) — §5.3.
 *
 * The response carries `meta.warnings` when the teacher is now over the tenant's
 * weekly-period norm. Those are advisory by design (§11 calls them warnings, and
 * a grid being built up mid-way has to be savable while over norm), so the save
 * succeeds and the warning is shown afterwards rather than blocking the dialog.
 */
export function AllocationForm() {
  const t = useTranslations("academics");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [warnings, setWarnings] = useState<AllocationLoadWarning[]>([]);

  const sessions = useAcademicSessions();
  const sections = useSections();
  const classes = useClasses();
  const subjects = useSubjects();
  const staff = useTeachingStaff();

  const classNames = useMemo(
    () => new Map((classes.data ?? []).map((option) => [option.id, option.name])),
    [classes.data],
  );

  const form = useForm<AllocationFormValues>({
    resolver: zodResolver(allocationSchema),
    defaultValues: EMPTY_VALUES,
  });
  const { handleSubmit, setError, reset } = form;

  const mutation = useMutation({
    mutationFn: async (values: AllocationFormValues) => {
      // Empty string → null here rather than in the schema: a blank period box
      // means "inherit the class-subject's target", which the column models as NULL.
      const payload = {
        academic_session_id: values.academic_session_id,
        section_id: values.section_id,
        subject_id: values.subject_id,
        staff_id: values.staff_id,
        is_primary: values.is_primary,
        weekly_periods: values.weekly_periods ? Number(values.weekly_periods) : null,
        effective_from: values.effective_from || null,
      };
      // Load warnings ride in the envelope's own `meta`, alongside the request
      // id — the server used to nest a second {data, meta} inside `data`, which
      // was a bug, not a contract.
      const result = await apiClient.post<TeacherAllocationRecord>(
        "/teacher-subject-allocations",
        payload,
      );
      return result;
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("academics") });
      setWarnings(
        (result.meta as { warnings?: AllocationLoadWarning[] } | undefined)?.warnings ?? [],
      );
      reset(EMPTY_VALUES);
      // Deliberately left open when the server warned: closing would hide the one
      // thing the user needs to read.
      const warned =
        ((result.meta as { warnings?: AllocationLoadWarning[] } | undefined)?.warnings ?? [])
          .length > 0;
      if (!warned) setOpen(false);
    },
    onError: (error: unknown) => {
      if (!(error instanceof ApiError)) return;
      const { known, unknown } = mapAllocationFieldErrors(error.fieldErrors());
      for (const [field, issue] of Object.entries(known)) {
        setError(field as keyof AllocationFormValues, { type: "server", message: issue });
      }
      if (unknown.length > 0) {
        setError("root", { type: "server", message: unknown.join(" ") });
      }
    },
  });

  const rootMessage = form.formState.errors.root?.message;
  const envelopeError = unhandledEnvelopeError(mutation.error);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          reset(EMPTY_VALUES);
          setWarnings([]);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">{t("allocations.actions.create")}</Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("allocations.form.createTitle")}</DialogTitle>
          <DialogDescription>{t("allocations.form.description")}</DialogDescription>
        </DialogHeader>

        <ApiErrorAlert error={envelopeError} />
        {rootMessage ? (
          <p role="alert" className="text-sm text-danger">
            {rootMessage}
          </p>
        ) : null}
        {warnings.map((warning) => (
          <Alert key={`${warning.code}-${warning.staff_id}`} variant="warning">
            <AlertDescription>
              {t("allocations.overNormWarning", {
                periods: warning.weekly_periods,
                norm: warning.norm,
              })}
            </AlertDescription>
          </Alert>
        ))}

        <Form {...form}>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              handleSubmit((values) => {
                mutation.mutate(values);
              })(event).catch((error: unknown) => {
                console.error("Unexpected error while creating the allocation:", error);
              });
            }}
            noValidate
          >
            <FormField
              control={form.control}
              name="academic_session_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("fields.academicSession")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl required>
                      <SelectTrigger aria-label={t("fields.academicSession")}>
                        <SelectValue placeholder={t("fields.selectSession")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {(sessions.data ?? []).map((session) => (
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

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="section_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("fields.section")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl required>
                        <SelectTrigger aria-label={t("fields.section")}>
                          <SelectValue placeholder={t("fields.selectSection")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(sections.data ?? []).map((section) => (
                          <SelectItem key={section.id} value={section.id}>
                            {`${classNames.get(section.class_id) ?? ""} ${section.name}`.trim()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="subject_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("fields.subject")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl required>
                        <SelectTrigger aria-label={t("fields.subject")}>
                          <SelectValue placeholder={t("fields.selectSubject")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(subjects.data ?? []).map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="staff_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("fields.teacher")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl required>
                      <SelectTrigger aria-label={t("fields.teacher")}>
                        <SelectValue placeholder={t("fields.selectTeacher")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {(staff.data ?? []).map((teacher) => (
                        <SelectItem key={teacher.id} value={teacher.id}>
                          {`${teacher.first_name} ${teacher.last_name}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>{t("fields.teacherHint")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="weekly_periods"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.weeklyPeriods")}</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" min={1} inputMode="numeric" />
                    </FormControl>
                    <FormDescription>{t("allocations.form.weeklyPeriodsHint")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="effective_from"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.effectiveFrom")}</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} type="date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="is_primary"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-2">
                    <FormControl>
                      <input
                        type="checkbox"
                        name={field.name}
                        ref={field.ref}
                        checked={field.value}
                        onBlur={field.onBlur}
                        onChange={(event) => {
                          field.onChange(event.target.checked);
                        }}
                        className="size-4 rounded-[var(--sh-radius)] border border-border accent-[var(--sh-color-primary)]"
                      />
                    </FormControl>
                    <FormLabel>{t("fields.isPrimary")}</FormLabel>
                  </div>
                  <FormDescription>{t("allocations.form.isPrimaryHint")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="submit"
                isLoading={mutation.isPending}
                loadingLabel={tCommon("loading")}
              >
                {tCommon("save")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
