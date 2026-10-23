"use client";

import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
} from "@schoolhub/ui";

import { FormSelectField } from "@/components/form-select-field";
import { useCampuses } from "@/hooks/use-reference-data";
import {
  PERIOD_ALL_CAMPUSES,
  PERIOD_MIN_SEQUENCE,
  PERIOD_NAME_MAX,
  PERIOD_WEEKDAYS,
} from "@/services/modules/periods/periods-constant";
import type { PeriodFormValues } from "@/services/modules/periods/periods.schema";

/** The period form's inputs. Every field renders its own `FormMessage`, so a server error
 * the dialog maps onto it is shown under it. */
export function PeriodFormFields({ form }: { form: UseFormReturn<PeriodFormValues> }) {
  const t = useTranslations("timetable");
  const tCommon = useTranslations("common");
  const campusesQuery = useCampuses();

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("fields.name")}</FormLabel>
              <FormControl>
                <Input maxLength={PERIOD_NAME_MAX} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="sequence"
          render={({ field: { onChange, value, ...field } }) => (
            <FormItem>
              <FormLabel>{t("fields.sequence")}</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={PERIOD_MIN_SEQUENCE}
                  {...field}
                  // Cleared, `valueAsNumber` is NaN: shown as empty, and zod rejects it.
                  value={Number.isNaN(value) ? "" : value}
                  onChange={(event) => {
                    onChange(event.target.valueAsNumber);
                  }}
                />
              </FormControl>
              <FormDescription>{t("periods.form.sequenceHint")}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="start_time"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("fields.startTime")}</FormLabel>
              <FormControl>
                <Input type="time" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="end_time"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("fields.endTime")}</FormLabel>
              <FormControl>
                <Input type="time" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <FormSelectField
        form={form}
        name="campus_id"
        label={t("fields.campus")}
        placeholder={campusesQuery.isPending ? tCommon("loading") : t("fields.allCampuses")}
        options={campusesQuery.data ?? []}
        emptyOption={{ value: PERIOD_ALL_CAMPUSES, label: t("fields.allCampuses") }}
      />
      <FormField
        control={form.control}
        name="weekdays"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("fields.weekdays")}</FormLabel>
            <FormControl>
              <ToggleGroup
                type="multiple"
                variant="outline"
                className="flex-wrap justify-start"
                value={field.value.map(String)}
                onValueChange={(days) => {
                  field.onChange(days.map(Number));
                }}
              >
                {PERIOD_WEEKDAYS.map((day) => (
                  <ToggleGroupItem key={day} value={String(day)} aria-label={t(`weekdays.${day}`)}>
                    {t(`weekdaysShort.${day}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </FormControl>
            <FormDescription>{t("periods.form.weekdaysHint")}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="is_break"
        render={({ field }) => (
          <FormItem>
            <div className="flex items-center justify-between gap-3">
              <FormLabel>{t("fields.isBreak")}</FormLabel>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
            </div>
            <FormDescription>{t("periods.form.isBreakHint")}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
