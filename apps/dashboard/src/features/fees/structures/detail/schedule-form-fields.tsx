"use client";

import { useTranslations } from "next-intl";
import { useWatch, type UseFormReturn } from "react-hook-form";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Skeleton,
} from "@schoolhub/ui";

import { FormSelectField } from "@/components/form-select-field";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useTerms } from "@/hooks/use-reference-data";
import { enumLabel } from "@/lib/enum-label";
import { hasPermission } from "@/lib/permissions";
import type { FeeScheduleRecord, FeeStructureRecord } from "@/services";
import { FEE_FREQUENCIES } from "@/services/modules/fee-schedules/fee-schedules-constant";
import { dueRuleFor } from "@/services/modules/fee-schedules/fee-schedules-helper";
import type { FeeScheduleFormValues } from "@/services/modules/fee-schedules/fee-schedules.schema";
import { FEE_FREQUENCY_LABEL_KEY } from "@/features/fees/shared/fee-setup-labels";
import { useFeeHeadOptions } from "@/features/fees/shared/use-fee-options";

export interface ScheduleFormFieldsProps {
  form: UseFormReturn<FeeScheduleFormValues>;
  structure: FeeStructureRecord;
  /** The schedule being edited: its head stays offered even if the head has since been deactivated. */
  record?: FeeScheduleRecord;
}

/**
 * The schedule form's inputs: fee head, amount, frequency, and the one due rule the frequency
 * uses (a term, a day of the month, or a fixed date). The head and term selects mount once their
 * lists have loaded, so an edit's saved value is never blanked by an option that has not
 * registered yet. Every field renders its own `FormMessage`, so a server error the dialog maps
 * onto it shows under it.
 */
export function ScheduleFormFields({ form, structure, record }: ScheduleFormFieldsProps) {
  const t = useTranslations("fees");
  const { data: user } = useCurrentUser();
  const frequency = useWatch({ control: form.control, name: "frequency" });
  const rule = dueRuleFor(frequency);

  const headsQuery = useFeeHeadOptions();
  const canReadSessions = hasPermission(user, "school.academic-session.view");
  const termsQuery = useTerms(canReadSessions ? structure.academic_session : "");

  if (headsQuery.isLoading) return <Skeleton className="h-40 w-full" />;

  const heads = (headsQuery.data ?? []).filter(
    (head) => head.is_active !== false || head.id === record?.fee_head,
  );

  return (
    <>
      <FormSelectField
        form={form}
        name="fee_head"
        label={t("structures.schedules.form.head")}
        placeholder={t("structures.schedules.form.selectHead")}
        options={heads.map((head) => ({ id: head.id, name: `${head.code} ${head.name}` }))}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="amount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("structures.schedules.form.amount")}</FormLabel>
              <FormControl>
                <Input inputMode="decimal" className="tabular-nums" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormSelectField
          form={form}
          name="frequency"
          label={t("structures.schedules.form.frequency")}
          placeholder={t("structures.schedules.form.frequency")}
          options={FEE_FREQUENCIES.map((value) => ({
            id: value,
            name: enumLabel(t, FEE_FREQUENCY_LABEL_KEY, value),
          }))}
        />
      </div>
      {rule.usesTerm && !termsQuery.isLoading && (
        <FormSelectField
          form={form}
          name="term"
          label={t("structures.schedules.form.term")}
          placeholder={t("structures.schedules.form.selectTerm")}
          options={termsQuery.data ?? []}
        />
      )}
      {rule.usesDueDay && (
        <FormField
          control={form.control}
          name="due_day"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("structures.schedules.form.dueDay")}</FormLabel>
              <FormControl>
                <Input inputMode="numeric" className="tabular-nums" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
      {rule.usesDueDate && (
        <FormField
          control={form.control}
          name="due_date"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("structures.schedules.form.dueDate")}</FormLabel>
              <FormControl>
                <Input type="date" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </>
  );
}
