"use client";

import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";
import {
  Checkbox,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Label,
} from "@schoolhub/ui";

import type { PlanFormValues } from "@/services/modules/platform/platform.schema";
import { useAllFlags } from "@/features/platform/shared/use-platform-options";

/** A flag that gates a whole module; only these are a plan's to enable (A4). */
const MODULE_PREFIX = "module.";

/**
 * The modules a plan enables: one checkbox per `module.*` flag. A module the plan already has but
 * the flag list doesn't (or can't, without `platform.feature-flag.view`) still shows, so an edit
 * never drops it silently.
 */
export function PlanModulesField({ form }: { form: UseFormReturn<PlanFormValues> }) {
  const t = useTranslations("platform.plans.form");
  const flags = useAllFlags();

  return (
    <FormField
      control={form.control}
      name="enabled_modules"
      render={({ field }) => {
        const keys = [
          ...new Set([
            ...(flags.data ?? [])
              .map((flag) => flag.key)
              .filter((key) => key.startsWith(MODULE_PREFIX)),
            ...field.value,
          ]),
        ].sort();
        return (
          <FormItem>
            <FormLabel>{t("modules")}</FormLabel>
            <FormDescription>{t("modulesHint")}</FormDescription>
            {keys.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noModules")}</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {keys.map((key) => (
                  <li key={key} className="flex items-center gap-2">
                    {/* One checkbox per module, each named by its own label: the group's
                        FormControl id would repeat on every one. */}
                    <Checkbox
                      id={`plan-module-${key}`}
                      checked={field.value.includes(key)}
                      onCheckedChange={(checked) => {
                        field.onChange(
                          checked === true
                            ? [...field.value, key]
                            : field.value.filter((value) => value !== key),
                        );
                      }}
                    />
                    <Label htmlFor={`plan-module-${key}`} className="font-mono text-sm font-normal">
                      {key}
                    </Label>
                  </li>
                ))}
              </ul>
            )}
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}
