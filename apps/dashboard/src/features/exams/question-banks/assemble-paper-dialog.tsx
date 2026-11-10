"use client";

import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useFieldArray, useForm } from "react-hook-form";
import {
  Alert,
  Button,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Progress,
} from "@schoolhub/ui";
import { Plus } from "lucide-react";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useJobFileDownload, type JobFileDownload } from "@/hooks/use-job-file-download";
import { Services, type PaperShortfall, type QuestionBankRecord } from "@/services";
import {
  DEFAULT_DIFFICULTY,
  PAPER_ERROR_FIELDS,
  PAPER_JOB_MODULE,
  PAPER_TITLE_MAX,
} from "@/services/modules/question-banks/question-banks-constant";
import {
  buildPaperBlueprint,
  paperFilename,
  shortfallsFromError,
} from "@/services/modules/question-banks/question-banks-helper";
import {
  createPaperFormSchema,
  type PaperFormValues,
} from "@/services/modules/question-banks/question-banks.schema";
import { PaperSectionFields } from "./paper-section-fields";

/** The paper job, owned by the page so it outlives the dialog; `start` takes the accepted job
 * and the paper's title, which names the file. */
export interface PaperDownload extends Pick<
  JobFileDownload<string>,
  "isBusy" | "isStalled" | "progress"
> {
  start: (jobId: string, title: string) => void;
  resume: () => void;
}

export interface AssemblePaperDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bank: QuestionBankRecord;
  paper: PaperDownload;
}

/** A blank section: any topic, the default difficulty, each question's own marks. */
function newSection(): PaperFormValues["sections"][number] {
  return { title: "", topic: "", difficulty: DEFAULT_DIFFICULTY, count: "", marks_each: "" };
}

/** A finished job's question count and total marks, for the toast. */
function paperSummary(result: Record<string, unknown> | null) {
  const questions = typeof result?.questions === "number" ? result.questions : 0;
  const marks = typeof result?.total_marks === "string" ? result.total_marks : "";
  return { questions, marks };
}

/** The paper job behind the dialog. `BankHeader` holds it, which stays mounted when the dialog
 * closes, so a paper still downloads after its dialog is closed mid-job. */
export function usePaperDownload(): PaperDownload {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const [title, setTitle] = useState("");
  // The `202` is accepted by the dialog's own submit (so a refusal stays inline); the hook is
  // handed the accepted job to poll and download.
  const job = useJobFileDownload<string>({
    module: PAPER_JOB_MODULE,
    start: (jobId) => Promise.resolve({ jobId }),
    filename: paperFilename(title),
    messages: {
      startFailed: tCommon("submitFailed"),
      downloadFailed: t("questionBanks.paper.downloadFailed"),
      timedOut: t("questionBanks.paper.timedOut"),
      failed: t("questionBanks.paper.failed"),
      success: (result) => t("questionBanks.paper.ready", paperSummary(result)),
    },
  });
  return {
    isBusy: job.isBusy,
    isStalled: job.isStalled,
    progress: job.progress,
    start: (jobId, paperTitle) => {
      setTitle(paperTitle);
      job.run(jobId);
    },
    // A stalled job is resumed, never started again (`useJobFileDownload`).
    resume: () => {
      job.run("");
    },
  };
}

/**
 * Assembles a paper from the bank's approved questions by a blueprint: a title and its sections,
 * each a topic, difficulty, count and marks. The server checks the blueprint first and names
 * every section it cannot fill, which this lists under the form; otherwise it answers `202` with
 * a job, which `paper` (`usePaperDownload`, held by `BankHeader`) polls and whose
 * `result_file_id` it downloads. Papers are not kept in a list, so the dialog says to save the
 * file when it arrives; Assemble is held while the job runs, and closing the dialog does not lose
 * the paper, since the job lives on the page.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh
 * blueprint with no stale shortfall; a running job shows again on reopen, from `paper`.
 */
export function AssemblePaperDialog({ open, onOpenChange, bank, paper }: AssemblePaperDialogProps) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const [shortfalls, setShortfalls] = useState<PaperShortfall[]>([]);

  const schema = useMemo(
    () =>
      createPaperFormSchema({
        required: tCommon("requiredField"),
        countInvalid: t("questionBanks.paper.countInvalid"),
        marksInvalid: t("questionBanks.paper.marksInvalid"),
      }),
    [t, tCommon],
  );
  const form = useForm<PaperFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: "", sections: [newSection()] },
  });
  const sections = useFieldArray({ control: form.control, name: "sections" });

  /** The server's figures for one short section, in a sentence. */
  function shortfallText(shortfall: PaperShortfall) {
    const values = {
      number: shortfall.index + 1,
      requested: shortfall.requested,
      available: shortfall.available,
      difficulty: t(`questionBanks.difficultyInSentence.${shortfall.difficulty}`),
    };
    return shortfall.topic
      ? t("questionBanks.paper.shortfallTopic", { ...values, topic: shortfall.topic })
      : t("questionBanks.paper.shortfall", values);
  }

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: async (values: PaperFormValues) => {
      setShortfalls([]);
      try {
        return await Services.questionBanks.assemblePaper(bank.id, buildPaperBlueprint(values));
      } catch (error) {
        setShortfalls(shortfallsFromError(error));
        throw error;
      }
    },
    knownFields: PAPER_ERROR_FIELDS,
    onSuccess: (accepted, values) => {
      paper.start(accepted.jobId, values.title);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t("questionBanks.paper.title", { name: bank.name })}
      description={t("questionBanks.paper.intro")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending || paper.isBusy}
      submittingLabel={t("questionBanks.paper.assembling")}
      submitLabel={t("questionBanks.paper.submit")}
      // Held while a job is stalled too: a new run then would resume the stalled one instead.
      submitDisabled={paper.isBusy || paper.isStalled}
    >
      <Alert variant="info" appearance="light">
        {t("questionBanks.paper.downloadNow")}
      </Alert>
      {shortfalls.length > 0 && (
        <Alert variant="destructive" appearance="light">
          <ul className="list-disc space-y-1 ps-4">
            {shortfalls.map((shortfall) => (
              <li key={shortfall.index}>{shortfallText(shortfall)}</li>
            ))}
          </ul>
        </Alert>
      )}
      {paper.isBusy && (
        <div role="status" className="space-y-1.5">
          <Progress value={paper.progress} />
          <p className="text-xs text-muted-foreground">
            {t("questionBanks.paper.progress", { progress: paper.progress })}
          </p>
        </div>
      )}
      {paper.isStalled && (
        <Alert variant="warning" appearance="light">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{t("questionBanks.paper.stalled")}</span>
            <Button type="button" variant="outline" size="sm" onClick={paper.resume}>
              {t("questionBanks.paper.keepWaiting")}
            </Button>
          </div>
        </Alert>
      )}
      <FormField
        control={form.control}
        name="title"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("questionBanks.paper.paperTitle")}</FormLabel>
            <FormControl>
              <Input maxLength={PAPER_TITLE_MAX} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      {sections.fields.map((field, index) => (
        <PaperSectionFields
          key={field.id}
          form={form}
          index={index}
          onRemove={
            sections.fields.length > 1
              ? () => {
                  sections.remove(index);
                }
              : undefined
          }
        />
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          sections.append(newSection());
        }}
      >
        <Plus aria-hidden="true" />
        {t("questionBanks.paper.addSection")}
      </Button>
    </FormDialogLayout>
  );
}
