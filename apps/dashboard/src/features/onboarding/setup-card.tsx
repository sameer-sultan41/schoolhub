"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardHeading,
  CardTitle,
  Progress,
} from "@schoolhub/ui";
import { ArrowRight } from "lucide-react";

import { isSetupFinished, setupProgress } from "@/services/modules/onboarding/onboarding-helper";
import { actionableSteps, setupStepHref } from "./onboarding-steps";
import { useOnboarding } from "./use-onboarding";

/**
 * The home page's "Finish setting up" card: how far the school is, and a link to the first step
 * this viewer can act on. Shown only while setup is unfinished and some remaining step is this
 * viewer's to do (platform-admin §20 records its place on the home page). Nothing renders while
 * the checklist loads or if it fails: the card is a prompt, not a status the page depends on.
 */
export function SetupCard() {
  const t = useTranslations("onboarding");
  const { user, query } = useOnboarding({ untilCompleted: true });
  const record = query.data;
  if (!record || isSetupFinished(record)) return null;

  const next = actionableSteps(record, user)[0];
  if (!next) return null;

  const { settled, total, percent } = setupProgress(record);
  return (
    <Card>
      <CardHeader>
        <CardHeading>
          <CardTitle>{t("card.title")}</CardTitle>
          <CardDescription>{t("card.progress", { settled, total })}</CardDescription>
        </CardHeading>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Progress
          value={percent}
          aria-label={t("card.progressLabel")}
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="sm:flex-1"
        />
        <Button asChild>
          <Link href={setupStepHref(next.key)}>
            {t("card.continue")}
            <ArrowRight className="rtl:rotate-180" aria-hidden="true" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
