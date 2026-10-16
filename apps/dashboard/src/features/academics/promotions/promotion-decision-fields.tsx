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
  Textarea,
} from "@schoolhub/ui";

import { FormSelectField } from "@/components/form-select-field";
import { useClasses, useSections } from "@/hooks/use-reference-data";
import type { PromotionDecisionRecord, PromotionProposal } from "@/services";
import {
  OVERRIDE_REASON_MAX,
  PROMOTION_DECISION,
  PROMOTION_DECISIONS,
  PROMOTION_NO_SECTION,
  REMARKS_MAX,
} from "@/services/modules/promotions/promotions-constant";
import {
  deviatesFromProposal,
  targetsAfterDecisionChange,
} from "@/services/modules/promotions/promotions-helper";
import type { PromotionDecisionFormValues } from "@/services/modules/promotions/promotions.schema";

interface PickerOption {
  id: string;
  name: string;
}

/** `options`, plus the one a row already holds if the list lacks it (say, an inactive class). */
function withOption(
  options: readonly PickerOption[],
  id: string | null | undefined,
  name: string | null,
): PickerOption[] {
  if (!id || name === null || options.some((option) => option.id === id)) return [...options];
  return [...options, { id, name }];
}

export interface PromotionDecisionFieldsProps {
  form: UseFormReturn<PromotionDecisionFormValues>;
  /** The row being edited: its class is where a retained student stays. */
  decision: PromotionDecisionRecord;
  /** What the server proposed. With none recorded, only retaining or promoting on trial calls
   * for an override reason, as the server asks of such a row. */
  proposal: PromotionProposal | null;
}

/**
 * The decision editor's inputs, with the server's rules mirrored so a reviewer isn't offered
 * what it would refuse: graduating clears and disables the target class and section, retaining
 * fixes the class to the one the student is in, and a class always has its own sections. A
 * decision or class that differs from the proposal marks the override reason as required (the
 * server asks for it when the batch is submitted).
 */
export function PromotionDecisionFields({
  form,
  decision,
  proposal,
}: PromotionDecisionFieldsProps) {
  const t = useTranslations("academics");
  const selectedDecision = useWatch({ control: form.control, name: "decision" });
  const classId = useWatch({ control: form.control, name: "to_class_id" });
  const sectionId = useWatch({ control: form.control, name: "to_section_id" });

  const classesQuery = useClasses({ isActive: true });
  const sectionsQuery = useSections(classId, { isActive: true });

  const isGraduating = selectedDecision === PROMOTION_DECISION.graduated;
  const isRetained = selectedDecision === PROMOTION_DECISION.retained;
  const requiresOverride = deviatesFromProposal(proposal, {
    decision: selectedDecision,
    to_class_id: classId,
  });

  const decisionOptions = PROMOTION_DECISIONS.map((value) => ({
    id: value,
    name: t(`promotions.decisionValue.${value}`),
  }));
  // A retained student's class is where they already are, which may no longer be offered.
  const classOptions = withOption(
    withOption(classesQuery.data ?? [], decision.from_class_id, decision.from_class_name),
    decision.to_class_id,
    decision.to_class_name,
  );
  // Its own section stays selectable (it may be inactive) only while its own class is the one picked.
  const ownSectionId = classId === decision.to_class_id ? decision.to_section_id : null;
  const sectionOptions = withOption(
    sectionsQuery.data ?? [],
    ownSectionId,
    decision.to_section_name,
  );

  return (
    <>
      <FormSelectField
        form={form}
        name="decision"
        label={t("promotions.columns.decision")}
        placeholder={t("promotions.columns.decision")}
        options={decisionOptions}
        onPick={() => {
          const targets = targetsAfterDecisionChange(
            form.getValues("decision"),
            {
              to_class_id: form.getValues("to_class_id"),
              to_section_id: form.getValues("to_section_id"),
            },
            decision.from_class_id,
          );
          form.setValue("to_class_id", targets.to_class_id);
          form.setValue("to_section_id", targets.to_section_id);
          form.clearErrors(["to_class_id", "to_section_id"]);
        }}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormSelectField
          form={form}
          name="to_class_id"
          label={t("promotions.fields.toClass")}
          placeholder={t("fields.selectClass")}
          options={classOptions}
          disabled={isGraduating || isRetained}
          onPick={() => {
            form.setValue("to_section_id", "");
          }}
        />
        <FormSelectField
          form={form}
          name="to_section_id"
          label={t("promotions.fields.toSection")}
          placeholder={t("fields.selectSection")}
          options={sectionOptions}
          // Only while there is a section to take away; with none the placeholder says so.
          emptyOption={
            sectionId === ""
              ? undefined
              : { value: PROMOTION_NO_SECTION, label: t("promotions.fields.none") }
          }
          disabled={isGraduating || classId === ""}
          description={isGraduating ? undefined : t("promotions.fields.toSectionHint")}
        />
      </div>
      <FormField
        control={form.control}
        name="override_reason"
        render={({ field }) => (
          <FormItem>
            <FormLabel required={requiresOverride}>
              {t("promotions.fields.overrideReason")}
            </FormLabel>
            <FormControl required={requiresOverride}>
              <Textarea rows={3} maxLength={OVERRIDE_REASON_MAX} {...field} />
            </FormControl>
            <FormDescription>{t("promotions.fields.overrideReasonHint")}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="remarks"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("promotions.fields.remarks")}</FormLabel>
            <FormControl>
              <Textarea rows={2} maxLength={REMARKS_MAX} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
