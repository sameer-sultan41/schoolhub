"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ApiError } from "@schoolhub/api-client";
import {
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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { ApiErrorAlert, unhandledEnvelopeError } from "@/components/api-error-alert";
import type { CurriculumRecord } from "@/features/academics/academics-types";
import { mapCurriculumFieldErrors } from "@/features/academics/curriculum-map-field-errors";
import {
  curriculumSchema,
  type CurriculumFormValues,
} from "@/features/academics/curriculum-schema";
import { useSubjects } from "@/features/academics/use-academics-reference-data";
import {
  useAcademicSessions,
  useCampuses,
  useClasses,
} from "@/features/students/use-reference-data";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

interface CurriculumFormProps {
  mode: "create" | "edit";
  mapping?: CurriculumRecord;
}

function defaultValues(mapping: CurriculumRecord | undefined): CurriculumFormValues {
  return {
    academic_session_id: mapping?.academic_session_id ?? "",
    class_id: mapping?.class_id ?? "",
    subject_id: mapping?.subject_id ?? "",
    campus_id: mapping?.campus_id ?? "",
    is_elective: mapping?.is_elective ?? false,
    elective_group: mapping?.elective_group ?? "",
    weekly_periods: String(mapping?.weekly_periods ?? 1),
    notes: mapping?.notes ?? "",
  };
}

/**
 * Create or amend one `class_subjects` row (§5.1). Rendered inside a dialog from
 * the curriculum grid rather than on its own route: a mapping is four foreign
 * keys and a period count, and the grid is where a user knows which cell is
 * missing.
 *
 * The session, class and subject are locked while editing — together they are
 * the row's identity (`tenant, session, class, subject, campus` is unique), so
 * changing one is a delete-and-recreate, not an amendment.
 */
export function CurriculumForm({ mode, mapping }: CurriculumFormProps) {
  const t = useTranslations("academics");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const sessions = useAcademicSessions();
  const classes = useClasses();
  const subjects = useSubjects();
  const campuses = useCampuses();

  const form = useForm<CurriculumFormValues>({
    resolver: zodResolver(curriculumSchema),
    defaultValues: defaultValues(mapping),
  });
  const { handleSubmit, setError, reset } = form;

  const mutation = useMutation({
    mutationFn: async (values: CurriculumFormValues) => {
      // Empty string → null here, not in the schema: the schema describes what
      // the form holds, this describes what the wire accepts. `weekly_periods`
      // leaves the number input as a string for the same reason.
      const payload = {
        academic_session_id: values.academic_session_id,
        class_id: values.class_id,
        subject_id: values.subject_id,
        campus_id: values.campus_id || null,
        is_elective: values.is_elective,
        elective_group: values.elective_group || null,
        weekly_periods: Number(values.weekly_periods),
        notes: values.notes || null,
      };
      const result =
        mode === "create"
          ? await apiClient.post<CurriculumRecord>("/class-subjects", payload)
          : await apiClient.patch<CurriculumRecord>(
              `/class-subjects/${mapping?.id ?? ""}`,
              payload,
            );
      return result.data;
    },
    onSuccess: () => {
      // Invalidate, never write through: a curriculum row's server-side rules
      // (elective-group minimums, the session lock) can change rows this form
      // never touched, so the cache is refetched rather than patched.
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("academics") });
      setOpen(false);
      reset(defaultValues(mapping));
    },
    onError: (error: unknown) => {
      if (!(error instanceof ApiError)) return;
      const { known, unknown } = mapCurriculumFieldErrors(error.fieldErrors());
      for (const [field, issue] of Object.entries(known)) {
        setError(field as keyof CurriculumFormValues, { type: "server", message: issue });
      }
      if (unknown.length > 0) {
        setError("root", { type: "server", message: unknown.join(" ") });
      }
    },
  });

  const rootMessage = form.formState.errors.root?.message;
  const envelopeError = unhandledEnvelopeError(mutation.error);
  const isEdit = mode === "edit";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Both edges, not just the close: this form's own `onSuccess` invalidates
        // every academics query, so editing another row re-fetches this one while
        // the dialog is shut. Resetting only on close would reopen with the
        // stale values and submit them back.
        reset(defaultValues(mapping));
      }}
    >
      <DialogTrigger asChild>
        <Button variant={isEdit ? "outline" : "primary"} size="sm">
          {isEdit ? t("curriculum.actions.edit") : t("curriculum.actions.create")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("curriculum.form.editTitle") : t("curriculum.form.createTitle")}
          </DialogTitle>
          <DialogDescription>{t("curriculum.form.description")}</DialogDescription>
        </DialogHeader>

        <ApiErrorAlert error={envelopeError} />
        {rootMessage ? (
          <p role="alert" className="text-sm text-danger">
            {rootMessage}
          </p>
        ) : null}

        <Form {...form}>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              handleSubmit((values) => {
                mutation.mutate(values);
              })(event).catch((error: unknown) => {
                console.error("Unexpected error while submitting the curriculum form:", error);
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
                  <Select value={field.value} onValueChange={field.onChange} disabled={isEdit}>
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
                name="class_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("fields.class")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange} disabled={isEdit}>
                      <FormControl required>
                        <SelectTrigger aria-label={t("fields.class")}>
                          <SelectValue placeholder={t("fields.selectClass")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(classes.data ?? []).map((option) => (
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
              <FormField
                control={form.control}
                name="subject_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("fields.subject")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange} disabled={isEdit}>
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

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="campus_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.campus")}</FormLabel>
                    <Select value={field.value ?? ""} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger aria-label={t("fields.campus")}>
                          <SelectValue placeholder={t("fields.allCampuses")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(campuses.data ?? []).map((campus) => (
                          <SelectItem key={campus.id} value={campus.id}>
                            {campus.name}
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
                name="weekly_periods"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("fields.weeklyPeriods")}</FormLabel>
                    <FormControl required>
                      <Input {...field} type="number" min={1} inputMode="numeric" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="is_elective"
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
                    <FormLabel>{t("fields.isElective")}</FormLabel>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="elective_group"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fields.electiveGroup")}</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fields.notes")}</FormLabel>
                  <FormControl>
                    <Textarea {...field} value={field.value ?? ""} />
                  </FormControl>
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
