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
  Skeleton,
} from "@schoolhub/ui";

import { FormSelectField } from "@/components/form-select-field";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useClasses, useSubjects } from "@/hooks/use-reference-data";
import { hasPermission } from "@/lib/permissions";
import {
  BANK_NAME_MAX,
  BANK_STATUSES,
  EVERY_LEVEL_OPTION,
} from "@/services/modules/question-banks/question-banks-constant";
import type { BankFormValues } from "@/services/modules/question-banks/question-banks.schema";

/**
 * The bank form's inputs: name, subject, class (or every level), status and description. Every
 * field renders its own `FormMessage`, so a server error the dialog maps onto it shows under it.
 * The subject and class lists are read only for a holder of their view keys (L55), and the two
 * selects mount once their options have loaded, so an edit's saved value is never blanked by a
 * select whose option has not registered yet.
 */
export function QuestionBankFormFields({ form }: { form: UseFormReturn<BankFormValues> }) {
  const t = useTranslations("exams");
  const { data: user } = useCurrentUser();
  const canReadSubjects = hasPermission(user, "school.subject.view");
  const canReadClasses = hasPermission(user, "school.class.view");
  const subjectsQuery = useSubjects({ isActive: true, enabled: canReadSubjects });
  const classesQuery = useClasses({ isActive: true, enabled: canReadClasses });
  const optionsLoading = subjectsQuery.isLoading || classesQuery.isLoading;

  const statusOptions = BANK_STATUSES.map((status) => ({
    id: status,
    name: t(`questionBanks.status.${status}`),
  }));

  return (
    <>
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("questionBanks.form.name")}</FormLabel>
            <FormControl>
              <Input maxLength={BANK_NAME_MAX} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      {optionsLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormSelectField
            form={form}
            name="subject_id"
            label={t("questionBanks.form.subject")}
            placeholder={t("questionBanks.form.selectSubject")}
            options={subjectsQuery.data ?? []}
            description={canReadSubjects ? undefined : t("questionBanks.form.noSubjectAccess")}
          />
          <FormSelectField
            form={form}
            name="class_id"
            label={t("questionBanks.form.class")}
            placeholder={t("questionBanks.form.everyLevel")}
            options={classesQuery.data ?? []}
            emptyOption={{ value: EVERY_LEVEL_OPTION, label: t("questionBanks.form.everyLevel") }}
            description={t("questionBanks.form.classHint")}
          />
        </div>
      )}
      <FormSelectField
        form={form}
        name="status"
        label={t("questionBanks.form.status")}
        placeholder={t("questionBanks.form.status")}
        options={statusOptions}
      />
      <FormField
        control={form.control}
        name="description"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("questionBanks.form.description")}</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
