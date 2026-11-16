"use client";

import { useTranslations } from "next-intl";
import { useWatch, type UseFormReturn } from "react-hook-form";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Switch,
} from "@schoolhub/ui";

import { EVENT_LOCATION_MAX } from "@/services/modules/website/school-events/school-events-constant";
import { switchAllDay, type EventFormValues } from "./event-form-schema";

/** The two date inputs, in display order. */
const DATE_FIELDS = [
  ["starts_at", "startsAt", true],
  ["ends_at", "endsAt", false],
] as const;

/**
 * When and where: "All day", the start and the optional end (`date` inputs for an all-day event,
 * else `datetime-local`), and the location. Switching "All day" keeps each value's day. Every
 * field renders its own `FormMessage`, so the end-before-start check, client or server, shows
 * under the end.
 */
export function EventDateFields({ form }: { form: UseFormReturn<EventFormValues> }) {
  const t = useTranslations("website.events.form");
  const isAllDay = useWatch({ control: form.control, name: "is_all_day" });

  return (
    <>
      <FormField
        control={form.control}
        name="is_all_day"
        render={({ field }) => (
          <FormItem>
            <div className="flex items-center justify-between gap-3">
              <FormLabel>{t("allDay")}</FormLabel>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={(checked) => {
                    field.onChange(checked);
                    for (const [name] of DATE_FIELDS) {
                      form.setValue(name, switchAllDay(form.getValues(name), checked));
                    }
                  }}
                />
              </FormControl>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {DATE_FIELDS.map(([name, labelKey, required]) => (
          <FormField
            key={name}
            control={form.control}
            name={name}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t(labelKey)}</FormLabel>
                <FormControl required={required}>
                  <Input type={isAllDay ? "date" : "datetime-local"} {...field} />
                </FormControl>
                {required ? null : <FormDescription>{t("endsAtHint")}</FormDescription>}
                <FormMessage />
              </FormItem>
            )}
          />
        ))}
      </div>
      <FormField
        control={form.control}
        name="location"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("location")}</FormLabel>
            <FormControl>
              <Input {...field} maxLength={EVENT_LOCATION_MAX} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
