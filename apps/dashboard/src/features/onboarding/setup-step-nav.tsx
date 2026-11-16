"use client";

import { useTranslations } from "next-intl";
import { Button, cn } from "@schoolhub/ui";
import { CircleCheck, CircleDashed, CircleSlash } from "lucide-react";

import type { OnboardingStep, OnboardingStepKey } from "@/services";

export interface SetupStepNavProps {
  steps: readonly OnboardingStep[];
  activeKey: OnboardingStepKey;
  onSelect: (key: OnboardingStepKey) => void;
}

function StepIcon({ step }: { step: OnboardingStep }) {
  const className = "size-4 shrink-0";
  if (step.done)
    return <CircleCheck className={cn(className, "text-success")} aria-hidden="true" />;
  if (step.skipped) {
    return <CircleSlash className={cn(className, "text-muted-foreground")} aria-hidden="true" />;
  }
  return <CircleDashed className={cn(className, "text-muted-foreground")} aria-hidden="true" />;
}

/**
 * The wizard's step list. Any step can be opened in any order: progress comes from the school's
 * data, not from walking the list. Each entry says whether it is done, skipped or still to do, and
 * how many records count towards it.
 */
export function SetupStepNav({ steps, activeKey, onSelect }: SetupStepNavProps) {
  const t = useTranslations("onboarding");
  return (
    <nav aria-label={t("nav.label")}>
      <ol className="space-y-1">
        {steps.map((step) => {
          const status = step.done
            ? t("status.done")
            : step.skipped
              ? t("status.skipped")
              : t("status.todo");
          const isActive = step.key === activeKey;
          return (
            <li key={step.key}>
              <Button
                variant="ghost"
                aria-current={isActive ? "step" : undefined}
                className={cn(
                  "h-auto w-full justify-start gap-3 px-3 py-2 text-start",
                  isActive && "bg-accent",
                )}
                onClick={() => {
                  onSelect(step.key);
                }}
              >
                <StepIcon step={step} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{t(`steps.${step.key}.title`)}</span>
                  <span className="text-xs text-muted-foreground">
                    {step.count === undefined
                      ? status
                      : `${status} · ${t("status.count", { count: step.count })}`}
                  </span>
                </span>
              </Button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
