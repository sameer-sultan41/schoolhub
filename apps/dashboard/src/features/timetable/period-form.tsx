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
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { ApiErrorAlert, unhandledEnvelopeError } from "@/components/api-error-alert";
import { mapPeriodFieldErrors } from "@/features/timetable/period-map-field-errors";
import { periodSchema, type PeriodFormValues } from "@/features/timetable/period-schema";
import { NONE, WEEKDAYS } from "@/features/timetable/timetable-constants";
import type { PeriodRecord } from "@/features/timetable/timetable-types";
import { useCampusOptions } from "@/features/timetable/use-timetable-reference-data";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

function valuesFor(period: PeriodRecord | undefined): PeriodFormValues {
  return {
    campus_id: period?.campus_id ?? NONE,
    name: period?.name ?? "",
    sequence: period ? String(period.sequence) : "",
    // TimeFields come back as "HH:MM:SS"; <input type="time"> wants "HH:MM".
    start_time: period?.start_time.slice(0, 5) ?? "",
    end_time: period?.end_time.slice(0, 5) ?? "",
    is_break: period?.is_break ?? false,
    weekdays: period?.weekdays ?? [],
  };
}

interface PeriodFormProps {
  /** Omit to create. */
  period?: PeriodRecord;
}

/**
 * One row of the bell schedule (§5.1). Creates and edits with the same fields —
 * a period has no lifecycle, only values.
 */
export function PeriodForm({ period }: PeriodFormProps) {
  const t = useTranslations("timetable");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const campuses = useCampusOptions();

  const form = useForm<PeriodFormValues>({
    resolver: zodResolver(periodSchema),
    defaultValues: valuesFor(period),
  });
  const { handleSubmit, setError, reset, control } = form;

  // useWatch, never form.watch(): a break is never schedulable (§5.1), so the
  // weekday picker is pointless for one — and watch() would re-render every
  // input on every keystroke in the name box.
  const isBreak = useWatch({ control, name: "is_break" });
  const weekdays = useWatch({ control, name: "weekdays" });

  const mutation = useMutation({
    mutationFn: (values: PeriodFormValues) => {
      const payload = {
        // The sentinel → null here rather than in the schema: a null campus is a
        // real, meaningful state ("every campus", per the column's help text),
        // not an absent value.
        campus_id: values.campus_id === NONE ? null : values.campus_id,
        name: values.name,
        sequence: Number(values.sequence),
        start_time: values.start_time,
        end_time: values.end_time,
        is_break: values.is_break,
        // Empty → null: NULL means "the tenant's working days", while an empty
        // list would mean "no days at all".
        weekdays: values.weekdays.length > 0 ? [...values.weekdays].sort() : null,
      };
      return period
        ? apiClient.patch<PeriodRecord>(`/periods/${period.id}`, payload)
        : apiClient.post<PeriodRecord>("/periods", payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("timetable") });
      reset(valuesFor(period));
      setOpen(false);
    },
    onError: (error: unknown) => {
      if (!(error instanceof ApiError)) return;
      const { known, unknown } = mapPeriodFieldErrors(error.fieldErrors());
      for (const [field, issue] of Object.entries(known)) {
        setError(field as keyof PeriodFormValues, { type: "server", message: issue });
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
        if (!next) reset(valuesFor(period));
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant={period ? "outline" : "primary"}>
          {period ? t("periods.actions.edit") : t("periods.actions.create")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>
            {period ? t("periods.form.editTitle") : t("periods.form.createTitle")}
          </DialogTitle>
          <DialogDescription>{t("periods.form.description")}</DialogDescription>
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
                console.error("Unexpected error while saving the period:", error);
              });
            }}
            noValidate
          >
            <FormField
              control={control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("fields.name")}</FormLabel>
                  <FormControl required>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={control}
                name="sequence"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("fields.sequence")}</FormLabel>
                    <FormControl required>
                      <Input {...field} type="number" min={1} inputMode="numeric" />
                    </FormControl>
                    <FormDescription>{t("periods.form.sequenceHint")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name="campus_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.campus")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger aria-label={t("fields.campus")}>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NONE}>{t("fields.allCampuses")}</SelectItem>
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
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={control}
                name="start_time"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("fields.startTime")}</FormLabel>
                    <FormControl required>
                      <Input {...field} type="time" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name="end_time"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("fields.endTime")}</FormLabel>
                    <FormControl required>
                      <Input {...field} type="time" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={control}
              name="is_break"
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
                    <FormLabel>{t("fields.isBreak")}</FormLabel>
                  </div>
                  <FormDescription>{t("periods.form.isBreakHint")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {isBreak ? null : (
              <FormField
                control={control}
                name="weekdays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.weekdays")}</FormLabel>
                    <div className="flex flex-wrap gap-3">
                      {WEEKDAYS.map((day) => (
                        <label key={day} className="flex items-center gap-1.5 text-sm">
                          <input
                            type="checkbox"
                            checked={weekdays.includes(day)}
                            onChange={(event) => {
                              field.onChange(
                                event.target.checked
                                  ? [...weekdays, day]
                                  : weekdays.filter((value) => value !== day),
                              );
                            }}
                            className="size-4 rounded-[var(--sh-radius)] border border-border accent-[var(--sh-color-primary)]"
                          />
                          {t(`weekdays.${day}`)}
                        </label>
                      ))}
                    </div>
                    <FormDescription>{t("periods.form.weekdaysHint")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

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
