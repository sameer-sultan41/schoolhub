"use client";

import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  RadioGroup,
  RadioGroupItem,
} from "@schoolhub/ui";

import { FormSelectField } from "@/components/form-select-field";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useTerms } from "@/hooks/use-reference-data";
import { hasPermission } from "@/lib/permissions";
import type { GenerateInvoicesFormValues } from "@/services/modules/fee-invoices/fee-invoices.schema";
import { useFeeStructureOptions } from "@/features/fees/shared/use-fee-options";

/**
 * The generate form: an active structure (only an active one prices invoices), then one period,
 * a calendar month or one of the structure's session's terms. The server refuses both and
 * neither, so the form takes exactly one. Terms are read only for a holder of
 * `school.academic-session.view` (L55); a viewer without it can still bill by month.
 */
export function GenerateInvoicesFields({
  form,
}: {
  form: UseFormReturn<GenerateInvoicesFormValues>;
}) {
  const t = useTranslations("fees");
  const { data: user } = useCurrentUser();
  const canReadStructures = hasPermission(user, "fees.fee-structure.view");
  const canReadSessions = hasPermission(user, "school.academic-session.view");

  const structures = useFeeStructureOptions({ status: "active", enabled: canReadStructures });
  const structureId = form.watch("fee_structure");
  const by = form.watch("by");
  const sessionId = structures.data?.find((row) => row.id === structureId)?.academic_session ?? "";
  const terms = useTerms(canReadSessions ? sessionId : "");

  return (
    <>
      <FormSelectField
        form={form}
        name="fee_structure"
        label={t("invoices.generate.structure")}
        placeholder={t("invoices.generate.selectStructure")}
        options={structures.data ?? []}
        onPick={() => {
          form.setValue("term", "");
        }}
        description={t("invoices.generate.structureHint")}
      />
      <FormField
        control={form.control}
        name="by"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("invoices.generate.by")}</FormLabel>
            <FormControl>
              <RadioGroup
                value={field.value}
                onValueChange={field.onChange}
                className="flex flex-wrap gap-4"
              >
                {(["month", "term"] as const).map((choice) => (
                  <label key={choice} className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value={choice} />
                    {t(`invoices.generate.by_${choice}`)}
                  </label>
                ))}
              </RadioGroup>
            </FormControl>
          </FormItem>
        )}
      />
      {by === "month" ? (
        <FormField
          control={form.control}
          name="period_start"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("invoices.generate.month")}</FormLabel>
              <FormControl>
                <Input type="month" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : (
        <FormSelectField
          form={form}
          name="term"
          label={t("invoices.generate.term")}
          placeholder={t("invoices.generate.selectTerm")}
          options={terms.data ?? []}
          disabled={structureId === ""}
          description={t("invoices.generate.termHint")}
        />
      )}
    </>
  );
}
