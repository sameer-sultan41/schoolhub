"use client";

import { useTranslations } from "next-intl";
import { cn } from "@schoolhub/ui";
import { Check, Minus } from "lucide-react";

import type { ExamStatus } from "@/services";
import { EXAM_STATUSES, TERMINAL_EXAM_STATUS } from "@/services/modules/exams/exams-constant";
import { stepState, type StepState } from "@/services/modules/exams/exams-helper";
import { EXAM_STATUS_STYLE } from "@/features/exams/exam-status-badge";

const MARKER_CLASS: Record<StepState, string> = {
  done: "border-primary bg-primary text-primary-foreground",
  current: "border-primary bg-background text-primary ring-2 ring-primary/30",
  upcoming: "border-border bg-muted text-muted-foreground",
  skipped: "border-dashed border-border bg-background text-muted-foreground",
};

/**
 * The exam's lifecycle as a row of steps, one per `ExamStatus`, from Draft to Archived: done
 * steps checked, the current one ringed, later ones muted. `ongoing` is skippable (nothing sets
 * it) so, once the exam is past it, it shows as skipped rather than done; `archived` is terminal
 * and says so. State is carried by icon, label and screen-reader text, never by colour alone.
 */
export function ExamStatusStepper({ status }: { status: ExamStatus }) {
  const t = useTranslations("exams");

  return (
    <ol
      aria-label={t("detail.stepper.label")}
      className="flex flex-wrap items-start gap-x-6 gap-y-3"
    >
      {EXAM_STATUSES.map((step) => {
        const state = stepState(step, status);
        const Icon =
          state === "done" ? Check : state === "skipped" ? Minus : EXAM_STATUS_STYLE[step].icon;
        return (
          <li
            key={step}
            aria-current={state === "current" ? "step" : undefined}
            className="flex items-center gap-2"
          >
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full border",
                MARKER_CLASS[state],
              )}
            >
              <Icon className="size-3.5" aria-hidden="true" />
            </span>
            <span
              className={cn(
                "text-sm",
                state === "current" ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              {t(`status.${step}`)}
              <span className="sr-only">
                {" "}
                ({t(`detail.stepper.${state}`)}
                {step === TERMINAL_EXAM_STATUS ? `, ${t("detail.stepper.terminal")}` : ""})
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
