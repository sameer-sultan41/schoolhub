"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import type { AuthenticatedUser } from "@schoolhub/types";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, Button, Card, CardContent } from "@schoolhub/ui";
import { ArrowRight } from "lucide-react";

import { CampusesSection } from "@/features/school/campuses/campuses-section";
import { ClassesSection } from "@/features/school/classes/classes-section";
import { ProfileSection } from "@/features/school/profile/profile-section";
import { SessionsSection } from "@/features/school/sessions/sessions-section";
import { SubjectsSection } from "@/features/school/subjects/subjects-section";
import { hasPermission } from "@/lib/permissions";
import type { OnboardingStep, OnboardingStepKey, OnboardingUpdate } from "@/services";
import { ONBOARDING_UPDATE_PERMISSION } from "@/services/modules/onboarding/onboarding-constant";
import { GoLiveStep } from "./go-live-step";
import { canActOnStep, SETUP_STEPS } from "./onboarding-steps";

/** The School module's own sections, embedded whole: the same table, toolbar and dialogs as
 * `/school`, so the wizard has no forms or validation of its own. */
const EMBEDDED_SECTIONS: Partial<Record<OnboardingStepKey, ComponentType>> = {
  profile: ProfileSection,
  campuses: CampusesSection,
  academic_session: SessionsSection,
  classes: ClassesSection,
  subjects: SubjectsSection,
};

export interface SetupStepPanelProps {
  step: OnboardingStep;
  user: AuthenticatedUser | undefined;
  previousKey: OnboardingStepKey | undefined;
  nextKey: OnboardingStepKey | undefined;
  onNavigate: (key: OnboardingStepKey) => void;
  onUpdate: (body: OnboardingUpdate) => void;
  isUpdating: boolean;
}

/** One step: what it asks for, the way to do it (embedded, a link, or go-live), and the step's
 * own actions — confirm for the profile, skip or undo for a skippable step, previous and next. */
export function SetupStepPanel({
  step,
  user,
  previousKey,
  nextKey,
  onNavigate,
  onUpdate,
  isUpdating,
}: SetupStepPanelProps) {
  const t = useTranslations("onboarding");
  const definition = SETUP_STEPS[step.key];
  const canAct = canActOnStep(user, step.key);
  const canUpdate = hasPermission(user, ONBOARDING_UPDATE_PERMISSION);
  const Embedded = EMBEDDED_SECTIONS[step.key];

  function body() {
    if (!canAct) {
      return (
        <Alert>
          <AlertDescription>{t("noAccess")}</AlertDescription>
        </Alert>
      );
    }
    if (definition.kind === "goLive") {
      return (
        <GoLiveStep
          done={step.done}
          onGoToSessions={() => {
            onNavigate("academic_session");
          }}
        />
      );
    }
    if (definition.link) {
      return (
        <Button variant="outline" asChild>
          <Link href={definition.link.href}>
            {t(`actions.${definition.link.labelKey}`)}
            <ArrowRight className="rtl:rotate-180" aria-hidden="true" />
          </Link>
        </Button>
      );
    }
    return Embedded ? <Embedded /> : null;
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-1 p-5">
          {/* An embedded section brings its own heading; the others need one. */}
          {!(Embedded && canAct) && (
            <h2 className="text-lg font-semibold">{t(`steps.${step.key}.title`)}</h2>
          )}
          <p className="text-sm text-muted-foreground">{t(`steps.${step.key}.description`)}</p>
        </CardContent>
      </Card>
      {body()}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {step.key === "profile" && canUpdate && (
            <Button
              disabled={step.done || isUpdating}
              onClick={() => {
                onUpdate({ confirm: "profile" });
              }}
            >
              {step.done ? t("actions.profileConfirmed") : t("actions.confirmProfile")}
            </Button>
          )}
          {step.skippable && canUpdate && !step.done && (
            <Button
              variant="outline"
              disabled={isUpdating}
              onClick={() => {
                onUpdate(step.skipped ? { unskip: step.key } : { skip: step.key });
              }}
            >
              {step.skipped ? t("actions.unskip") : t("actions.skip")}
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          {previousKey && (
            <Button
              variant="outline"
              onClick={() => {
                onNavigate(previousKey);
              }}
            >
              {t("actions.back")}
            </Button>
          )}
          {nextKey && (
            <Button
              variant="outline"
              onClick={() => {
                onNavigate(nextKey);
              }}
            >
              {t("actions.next")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
