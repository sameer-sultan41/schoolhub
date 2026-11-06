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
  Textarea,
} from "@schoolhub/ui";

import { FormSelectField } from "@/components/form-select-field";
import {
  QUESTION_DIFFICULTIES,
  QUESTION_TYPES,
  TOPIC_MAX,
  TRUE_FALSE_OPTIONS,
} from "@/services/modules/question-banks/question-banks-constant";
import type { QuestionFormValues } from "@/services/modules/question-banks/question-banks.schema";

type QuestionForm = UseFormReturn<QuestionFormValues>;

/** A plain text input with its label, optional hint and its own `FormMessage`. */
function TextField({
  form,
  name,
  label,
  hint,
  maxLength,
  inputMode,
}: {
  form: QuestionForm;
  name: "default_marks" | "topic" | "answer_key";
  label: string;
  hint?: string;
  maxLength?: number;
  inputMode?: "decimal";
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input maxLength={maxLength} inputMode={inputMode} {...field} />
          </FormControl>
          {hint && <FormDescription>{hint}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/**
 * The question form's inputs, each type with its own: a multiple-choice question its choices
 * (one per line) and the correct one, a true/false question True or False, a long answer a model
 * answer, any other a short answer key. A new type clears the answer, which belonged to the old
 * one. Every field renders its own `FormMessage`, so a server error mapped onto it shows under it.
 */
export function QuestionFormFields({ form }: { form: QuestionForm }) {
  const t = useTranslations("exams");
  const questionType = useWatch({ control: form.control, name: "question_type" });

  const typeOptions = QUESTION_TYPES.map((type) => ({
    id: type,
    name: t(`questionBanks.types.${type}`),
  }));
  const difficultyOptions = QUESTION_DIFFICULTIES.map((difficulty) => ({
    id: difficulty,
    name: t(`questionBanks.difficulty.${difficulty}`),
  }));
  const trueFalseOptions = TRUE_FALSE_OPTIONS.map((option) => ({
    id: option,
    name: t(`questionBanks.questions.form.trueFalse.${option}`),
  }));

  return (
    <>
      <FormField
        control={form.control}
        name="question_text"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("questionBanks.questions.form.text")}</FormLabel>
            <FormControl>
              <Textarea rows={3} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormSelectField
          form={form}
          name="question_type"
          label={t("questionBanks.questions.form.type")}
          placeholder={t("questionBanks.questions.form.type")}
          options={typeOptions}
          onPick={() => {
            form.setValue("answer_key", "");
          }}
        />
        <FormSelectField
          form={form}
          name="difficulty"
          label={t("questionBanks.questions.form.difficulty")}
          placeholder={t("questionBanks.questions.form.difficulty")}
          options={difficultyOptions}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          form={form}
          name="default_marks"
          label={t("questionBanks.questions.form.marks")}
          inputMode="decimal"
        />
        <TextField
          form={form}
          name="topic"
          label={t("questionBanks.questions.form.topic")}
          hint={t("questionBanks.questions.form.topicHint")}
          maxLength={TOPIC_MAX}
        />
      </div>
      {questionType === "mcq" && (
        <FormField
          control={form.control}
          name="options"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("questionBanks.questions.form.options")}</FormLabel>
              <FormControl>
                <Textarea rows={4} {...field} />
              </FormControl>
              <FormDescription>{t("questionBanks.questions.form.optionsHint")}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
      {questionType === "true_false" && (
        <FormSelectField
          form={form}
          name="answer_key"
          label={t("questionBanks.questions.form.answer")}
          placeholder={t("questionBanks.questions.form.selectAnswer")}
          options={trueFalseOptions}
        />
      )}
      {questionType === "long_answer" && (
        <FormField
          control={form.control}
          name="answer_key"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("questionBanks.questions.form.modelAnswer")}</FormLabel>
              <FormControl>
                <Textarea rows={3} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
      {questionType !== "true_false" && questionType !== "long_answer" && (
        <TextField
          form={form}
          name="answer_key"
          label={t("questionBanks.questions.form.answer")}
          hint={
            questionType === "mcq" ? t("questionBanks.questions.form.answerHintChoice") : undefined
          }
        />
      )}
    </>
  );
}
