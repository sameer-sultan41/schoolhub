"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ApiError, collectPages } from "@schoolhub/api-client";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { mapSubstitutionFieldErrors } from "@/features/timetable/substitution-map-field-errors";
import {
  substitutionSchema,
  type SubstitutionFormValues,
} from "@/features/timetable/substitution-schema";
import { weekdayFromIsoDate } from "@/features/timetable/timetable-constants";
import { ApiErrorAlert, unhandledEnvelopeError } from "@/features/timetable/timetable-error-alert";
import type { SubstitutionRecord, TimetableSlotRecord } from "@/features/timetable/timetable-types";
import {
  usePeriodOptions,
  useSectionOptions,
  useSubjectOptions,
  useTeachingStaffOptions,
} from "@/features/timetable/use-timetable-reference-data";
import { useAcademicSessions, useClasses } from "@/features/students/use-reference-data";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

const EMPTY_VALUES: SubstitutionFormValues = {
  timetable_slot_id: "",
  date: "",
  substitute_staff_id: "",
  reason: "",
};

/**
 * Propose a substitution for one published slot on one date (§5.6).
 *
 * The order of the fields is the order the rules resolve in: pick a section and a
 * date, and only then the period, because the candidate periods are exactly the
 * *published* slots that section holds on that date's weekday —
 * `services.create_substitution` refuses a draft outright, and
 * `assert_substitution_valid` refuses a date that does not fall on the slot's
 * weekday. Narrowing the choices is better than validating them afterwards.
 */
export function SubstitutionForm() {
  const t = useTranslations("timetable");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [academicSessionId, setAcademicSessionId] = useState("");
  const [sectionId, setSectionId] = useState("");

  const sessions = useAcademicSessions();
  const classes = useClasses();
  const sections = useSectionOptions();
  const subjects = useSubjectOptions();
  const periods = usePeriodOptions();
  const staff = useTeachingStaffOptions();

  const form = useForm<SubstitutionFormValues>({
    resolver: zodResolver(substitutionSchema),
    defaultValues: EMPTY_VALUES,
  });
  const { handleSubmit, setError, reset, control } = form;

  // useWatch, never form.watch(): the candidate-slot query and the derived
  // absent teacher both depend on these two, and watch() would re-render the
  // whole dialog on every keystroke in the reason box as well.
  const date = useWatch({ control, name: "date" });
  const timetableSlotId = useWatch({ control, name: "timetable_slot_id" });

  const weekday = weekdayFromIsoDate(date);

  const candidateSlots = useQuery({
    queryKey: queryKeys.list("timetable", "timetable-slots", {
      academic_session_id: academicSessionId,
      section_id: sectionId,
      status: "published",
      weekday,
    }),
    queryFn: () =>
      collectPages<TimetableSlotRecord>(apiClient, "/timetable-slots", {
        query: {
          academic_session_id: academicSessionId,
          section_id: sectionId,
          status: "published",
          weekday,
        },
      }),
    enabled: Boolean(academicSessionId && sectionId) && weekday !== null,
  });

  const classNames = useMemo(
    () => new Map((classes.data ?? []).map((option) => [option.id, option.name])),
    [classes.data],
  );
  const subjectNames = useMemo(
    () => new Map((subjects.data ?? []).map((option) => [option.id, option.name])),
    [subjects.data],
  );
  const periodNames = useMemo(
    () => new Map((periods.data ?? []).map((period) => [period.id, period.name])),
    [periods.data],
  );
  const staffNames = useMemo(
    () =>
      new Map(
        (staff.data ?? []).map((teacher) => [
          teacher.id,
          `${teacher.first_name} ${teacher.last_name}`,
        ]),
      ),
    [staff.data],
  );

  // `status=published` alone is not "in force": a republish end-dates the row it
  // replaces rather than deleting it, and `effective_to` is what says so — the
  // same guard `week-grid-screen.tsx` puts on its cell index. Publish supersedes
  // only the cells a draft actually replaces, so retired rows accumulate beside
  // live ones as the year goes on, and offering one here would propose cover for
  // a class that no longer meets. The API has no `effective_to` filter to push
  // this down to; §16 names the five it does.
  const slotOptions = (candidateSlots.data ?? []).filter((slot) => !slot.effective_to);
  const selectedSlot = slotOptions.find((slot) => slot.id === timetableSlotId);
  // The absent teacher IS the slot's teacher — §11 requires them to match, so
  // this is shown, not chosen.
  const absentStaffId = selectedSlot?.staff_id ?? null;

  const mutation = useMutation({
    mutationFn: (values: SubstitutionFormValues) =>
      apiClient.post<SubstitutionRecord>("/teacher-substitutions", {
        timetable_slot_id: values.timetable_slot_id,
        date: values.date,
        absent_staff_id: absentStaffId,
        substitute_staff_id: values.substitute_staff_id,
        // Empty string → null here rather than in the schema: the column is
        // nullable and "no reason given" is a real state.
        reason: values.reason || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("timetable") });
      reset(EMPTY_VALUES);
      setOpen(false);
    },
    onError: (error: unknown) => {
      if (!(error instanceof ApiError)) return;
      const { known, unknown } = mapSubstitutionFieldErrors(error.fieldErrors());
      for (const [field, issue] of Object.entries(known)) {
        setError(field as keyof SubstitutionFormValues, { type: "server", message: issue });
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
        if (!next) reset(EMPTY_VALUES);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">{t("substitutions.actions.create")}</Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("substitutions.form.createTitle")}</DialogTitle>
          <DialogDescription>{t("substitutions.form.description")}</DialogDescription>
        </DialogHeader>

        <ApiErrorAlert error={envelopeError} />
        {rootMessage ? (
          <p role="alert" className="text-sm text-danger">
            {rootMessage}
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              {t("fields.academicSession")}
            </span>
            <Select value={academicSessionId} onValueChange={setAcademicSessionId}>
              <SelectTrigger aria-label={t("fields.academicSession")}>
                <SelectValue placeholder={t("fields.selectSession")} />
              </SelectTrigger>
              <SelectContent>
                {(sessions.data ?? []).map((session) => (
                  <SelectItem key={session.id} value={session.id}>
                    {session.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">{t("fields.section")}</span>
            <Select value={sectionId} onValueChange={setSectionId}>
              <SelectTrigger aria-label={t("fields.section")}>
                <SelectValue placeholder={t("fields.selectSection")} />
              </SelectTrigger>
              <SelectContent>
                {(sections.data ?? []).map((section) => (
                  <SelectItem key={section.id} value={section.id}>
                    {`${classNames.get(section.class_id) ?? ""} ${section.name}`.trim()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Form {...form}>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              handleSubmit((values) => {
                mutation.mutate(values);
              })(event).catch((error: unknown) => {
                console.error("Unexpected error while creating the substitution:", error);
              });
            }}
            noValidate
          >
            <FormField
              control={control}
              name="date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("fields.date")}</FormLabel>
                  <FormControl required>
                    <Input {...field} type="date" />
                  </FormControl>
                  <FormDescription>{t("substitutions.form.dateHint")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={control}
              name="timetable_slot_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("fields.period")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl required>
                      <SelectTrigger aria-label={t("fields.period")}>
                        <SelectValue placeholder={t("fields.selectPeriod")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {slotOptions.map((slot) => (
                        <SelectItem key={slot.id} value={slot.id}>
                          {`${periodNames.get(slot.period_id) ?? ""} · ${
                            slot.subject_id
                              ? (subjectNames.get(slot.subject_id) ?? "")
                              : t("grid.noSubject")
                          }`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>{t("substitutions.form.periodHint")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                {t("fields.absentTeacher")}
              </span>
              <p className="text-sm text-foreground">
                {absentStaffId
                  ? (staffNames.get(absentStaffId) ?? t("substitutions.form.unknownTeacher"))
                  : t("substitutions.form.pickPeriodFirst")}
              </p>
            </div>

            <FormField
              control={control}
              name="substitute_staff_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("fields.substituteTeacher")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl required>
                      <SelectTrigger aria-label={t("fields.substituteTeacher")}>
                        <SelectValue placeholder={t("fields.selectTeacher")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {(staff.data ?? [])
                        // The absentee cannot cover for themselves — a database
                        // constraint, so it must not even be offered.
                        .filter((teacher) => teacher.id !== absentStaffId)
                        .map((teacher) => (
                          <SelectItem key={teacher.id} value={teacher.id}>
                            {`${teacher.first_name} ${teacher.last_name}`}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>{t("substitutions.form.substituteHint")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fields.reason")}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="submit"
                disabled={!absentStaffId}
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
