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
  Label,
  RadioGroup,
  RadioGroupItem,
} from "@schoolhub/ui";

import type { AttendanceMode } from "@/services";
import {
  ESCALATION_THRESHOLD_MIN_DAYS,
  LOCK_WINDOW_MAX_DAYS,
  LOCK_WINDOW_MIN_DAYS,
} from "@/services/modules/attendance-settings/attendance-settings-constant";
import type { AttendanceSettingsFormValues } from "@/services/modules/attendance-settings/attendance-settings.schema";

const MODE_OPTIONS: readonly { value: AttendanceMode; labelKey: string; hintKey: string }[] = [
  { value: "daily", labelKey: "settings.mode.daily", hintKey: "settings.mode.dailyHint" },
  { value: "period", labelKey: "settings.mode.period", hintKey: "settings.mode.periodHint" },
];

export interface AttendanceSettingsFieldsProps {
  form: UseFormReturn<AttendanceSettingsFormValues>;
  /** False for a viewer who may read the settings but not change them. */
  canUpdate: boolean;
}

/** The three settings, each with the plain-language consequence of changing it. The notes sit
 * outside `FormDescription` so a server error under a field never hides them. */
export function AttendanceSettingsFields({ form, canUpdate }: AttendanceSettingsFieldsProps) {
  const t = useTranslations("attendance");

  return (
    <>
      <FormField
        control={form.control}
        name="attendance_mode"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("settings.mode.label")}</FormLabel>
            <FormControl>
              <RadioGroup
                aria-label={t("settings.mode.label")}
                value={field.value}
                onValueChange={field.onChange}
                disabled={!canUpdate}
              >
                {MODE_OPTIONS.map((option) => (
                  <div key={option.value} className="flex items-start gap-3">
                    <RadioGroupItem
                      id={`attendance-mode-${option.value}`}
                      value={option.value}
                      aria-describedby={`attendance-mode-${option.value}-hint`}
                    />
                    <div className="space-y-0.5">
                      <Label htmlFor={`attendance-mode-${option.value}`}>
                        {t(option.labelKey)}
                      </Label>
                      <p
                        id={`attendance-mode-${option.value}-hint`}
                        className="text-xs text-muted-foreground"
                      >
                        {t(option.hintKey)}
                      </p>
                    </div>
                  </div>
                ))}
              </RadioGroup>
            </FormControl>
            <FormMessage />
            <ul className="list-disc space-y-1 ps-5 text-xs text-muted-foreground">
              <li>{t("settings.mode.switchNote")}</li>
              <li>{t("settings.mode.periodNote")}</li>
            </ul>
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="lock_window_days"
        render={({ field }) => (
          <FormItem className="max-w-xs">
            <FormLabel>{t("settings.lockWindow.label")}</FormLabel>
            <FormControl>
              <Input
                type="number"
                inputMode="numeric"
                min={LOCK_WINDOW_MIN_DAYS}
                max={LOCK_WINDOW_MAX_DAYS}
                step={1}
                {...field}
                disabled={!canUpdate}
              />
            </FormControl>
            <FormDescription>{t("settings.lockWindow.hint")}</FormDescription>
            <FormMessage />
            <p className="text-xs text-muted-foreground">{t("settings.lockWindow.note")}</p>
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="leave_escalation_threshold_days"
        render={({ field }) => (
          <FormItem className="max-w-xs">
            <FormLabel>{t("settings.escalation.label")}</FormLabel>
            <FormControl>
              <Input
                type="number"
                inputMode="numeric"
                min={ESCALATION_THRESHOLD_MIN_DAYS}
                step={1}
                {...field}
                disabled={!canUpdate}
              />
            </FormControl>
            <FormDescription>{t("settings.escalation.hint")}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
