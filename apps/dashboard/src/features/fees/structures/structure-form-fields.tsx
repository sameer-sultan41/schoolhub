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
import { FEE_STRUCTURE_NAME_MAX } from "@/services/modules/fee-structures/fee-structures-constant";
import type { FeeStructureFormValues } from "@/services/modules/fee-structures/fee-structures.schema";
import { useStructureReferences } from "@/features/fees/shared/use-structure-references";

/** The scope selects' empty choice: a structure for every class or campus. */
const EVERY_OPTION = "every";

/**
 * The structure form's inputs: name, session, and the optional class and campus. The three
 * selects mount once their lists have loaded, so an edit's saved value is never blanked by an
 * option that has not registered yet. Every field renders its own `FormMessage`, so a server
 * error the dialog maps onto it shows under it.
 */
export function StructureFormFields({ form }: { form: UseFormReturn<FeeStructureFormValues> }) {
  const t = useTranslations("fees");
  const references = useStructureReferences();

  return (
    <>
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("structures.form.name")}</FormLabel>
            <FormControl>
              <Input maxLength={FEE_STRUCTURE_NAME_MAX} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      {references.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <FormSelectField
            form={form}
            name="academic_session"
            label={t("structures.form.session")}
            placeholder={t("structures.form.selectSession")}
            options={references.sessions}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormSelectField
              form={form}
              name="school_class"
              label={t("structures.form.class")}
              placeholder={t("structures.everyClass")}
              options={references.classes}
              emptyOption={{ value: EVERY_OPTION, label: t("structures.everyClass") }}
            />
            <FormSelectField
              form={form}
              name="campus"
              label={t("structures.form.campus")}
              placeholder={t("structures.everyCampus")}
              options={references.campuses}
              emptyOption={{ value: EVERY_OPTION, label: t("structures.everyCampus") }}
              description={t("structures.form.scopeHint")}
            />
          </div>
        </>
      )}
    </>
  );
}
