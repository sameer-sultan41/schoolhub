"use client";

import type { ComponentProps } from "react";
import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";
import {
  Button,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from "@schoolhub/ui";
import { Trash2 } from "lucide-react";

import { FormSelectField } from "@/components/form-select-field";
import {
  QUESTION_DIFFICULTIES,
  SECTION_TITLE_MAX,
  TOPIC_MAX,
} from "@/services/modules/question-banks/question-banks-constant";
import type { PaperFormValues } from "@/services/modules/question-banks/question-banks.schema";

type SectionField = "title" | "topic" | "count" | "marks_each";
type TextInputProps = Pick<ComponentProps<typeof Input>, "maxLength" | "inputMode">;

export interface PaperSectionFieldsProps {
  form: UseFormReturn<PaperFormValues>;
  index: number;
  /** Omitted while this is the paper's only section: a paper needs one. */
  onRemove?: () => void;
}

/**
 * One section of the blueprint: its title, the topic and difficulty its questions are drawn
 * from, how many, and the marks each (blank keeps each question's own). The group is named
 * "Section {n}", so every input in it is announced with its section.
 */
export function PaperSectionFields({ form, index, onRemove }: PaperSectionFieldsProps) {
  const t = useTranslations("exams");
  const number = index + 1;
  const difficultyOptions = QUESTION_DIFFICULTIES.map((difficulty) => ({
    id: difficulty,
    name: t(`questionBanks.difficulty.${difficulty}`),
  }));

  function textField(name: SectionField, label: string, props: TextInputProps = {}) {
    return (
      <FormField
        control={form.control}
        name={`sections.${index}.${name}`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{label}</FormLabel>
            <FormControl>
              <Input {...props} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    );
  }

  return (
    <div
      role="group"
      className="space-y-3 rounded-lg border border-border p-3"
      aria-label={t("questionBanks.paper.section", { number })}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">
          {t("questionBanks.paper.section", { number })}
        </p>
        {onRemove && (
          <Button
            type="button"
            variant="destructive"
            appearance="ghost"
            mode="icon"
            size="sm"
            aria-label={t("questionBanks.paper.removeSection", { number })}
            onClick={onRemove}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        )}
      </div>
      {textField("title", t("questionBanks.paper.sectionTitle"), { maxLength: SECTION_TITLE_MAX })}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {textField("topic", t("questionBanks.paper.topic"), { maxLength: TOPIC_MAX })}
        <FormSelectField
          form={form}
          name={`sections.${index}.difficulty`}
          label={t("questionBanks.paper.difficulty")}
          placeholder={t("questionBanks.paper.difficulty")}
          options={difficultyOptions}
        />
        {textField("count", t("questionBanks.paper.count"), { inputMode: "numeric" })}
        {textField("marks_each", t("questionBanks.paper.marksEach"), { inputMode: "decimal" })}
      </div>
    </div>
  );
}
