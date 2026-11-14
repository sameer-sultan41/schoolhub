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
} from "@schoolhub/ui";

import { useAcademicSession } from "@/components/academic-session/use-academic-session";
import { FormSelectField } from "@/components/form-select-field";
import { useTerms } from "@/hooks/use-reference-data";
import {
  EXAM_DESCRIPTION_MAX,
  EXAM_NAME_MAX,
  EXAM_TYPES,
} from "@/services/modules/exams/exams-constant";
import type { ExamFormValues } from "@/services/modules/exams/exams.schema";
import { useGradingScaleOptions } from "@/features/exams/use-grading-scale-options";

/** The exam form's inputs. Every field renders its own `FormMessage`, so a server error the
 * dialog maps onto it shows under it. A new session clears the term, which belongs to one. */
export function ExamFormFields({ form }: { form: UseFormReturn<ExamFormValues> }) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const sessionId = useWatch({ control: form.control, name: "academic_session_id" });
  const startsOn = useWatch({ control: form.control, name: "starts_on" });

  const { sessions, isLoading: sessionsLoading } = useAcademicSession("");
  const termsQuery = useTerms(sessionId);
  const scalesQuery = useGradingScaleOptions();

  return (
    <>
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("form.name")}</FormLabel>
            <FormControl>
              <Input maxLength={EXAM_NAME_MAX} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormSelectField
          form={form}
          name="academic_session_id"
          label={t("form.session")}
          placeholder={sessionsLoading ? tCommon("loading") : t("form.selectSession")}
          options={sessions ?? []}
          onPick={() => {
            form.setValue("term_id", "");
          }}
        />
        <FormSelectField
          form={form}
          name="term_id"
          label={t("form.term")}
          placeholder={t("form.selectTerm")}
          options={termsQuery.data ?? []}
          disabled={sessionId === ""}
          emptyOption={{ value: "none", label: t("form.noTerm") }}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormSelectField
          form={form}
          name="exam_type"
          label={t("form.type")}
          placeholder={t("form.type")}
          options={EXAM_TYPES.map((type) => ({ id: type, name: t(`types.${type}`) }))}
        />
        <FormSelectField
          form={form}
          name="grading_scale_id"
          label={t("form.gradingScale")}
          placeholder={scalesQuery.isPending ? tCommon("loading") : t("form.selectScale")}
          options={scalesQuery.data ?? []}
          emptyOption={{ value: "default", label: t("form.defaultScale") }}
        />
      </div>
      <FormField
        control={form.control}
        name="weightage_percent"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("form.weightage")}</FormLabel>
            <FormControl>
              <Input inputMode="decimal" {...field} />
            </FormControl>
            <FormDescription>{t("form.weightageHint")}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="starts_on"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("form.startsOn")}</FormLabel>
              <FormControl>
                <Input type="date" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="ends_on"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("form.endsOn")}</FormLabel>
              <FormControl>
                <Input type="date" min={startsOn || undefined} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <FormField
        control={form.control}
        name="description"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("form.description")}</FormLabel>
            <FormControl>
              <Input maxLength={EXAM_DESCRIPTION_MAX} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
