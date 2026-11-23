"use client";

import { useCallback, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button, Card, CardContent, Skeleton } from "@schoolhub/ui";
import { toast } from "sonner";

import { Toolbar, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { LoadErrorCard } from "@/components/load-error-card";
import { Paths } from "@/config/paths";
import { useUrlParams, type UrlParamUpdates } from "@/hooks/use-url-params";
import { queryKeys } from "@/lib/query-client";
import { Services, type OnboardingStepKey, type OnboardingUpdate } from "@/services";
import { SETUP_STEP_URL_KEY } from "@/services/modules/onboarding/onboarding-constant";
import { isSetupFinished, remainingSteps } from "@/services/modules/onboarding/onboarding-helper";
import { actionableSteps } from "./onboarding-steps";
import { SetupStepNav } from "./setup-step-nav";
import { SetupStepPanel } from "./setup-step-panel";
import { useOnboarding, useRefreshOnboardingOnWrites } from "./use-onboarding";

interface MessageCardProps {
  title: string;
  description: string;
  action?: ReactNode;
}

function MessageCard({ title, description, action }: MessageCardProps) {
  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-3 p-6">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
        {action}
      </CardContent>
    </Card>
  );
}

/**
 * `/setup`: the school's onboarding wizard (platform-admin §5.6). The step is in the URL
 * (`?step=`), and opening another step drops every other key, because the embedded School
 * sections keep their own list state (search, sort, page, filters) in the same query string under
 * unprefixed keys. Progress comes from `GET /onboarding`, refreshed after every write made here.
 */
export function SetupWizard() {
  const t = useTranslations("onboarding");
  const queryClient = useQueryClient();
  const { user, canView, query } = useOnboarding();
  const { searchParams, setParams } = useUrlParams();
  useRefreshOnboardingOnWrites();

  const goToStep = useCallback(
    (key: OnboardingStepKey) => {
      const updates: UrlParamUpdates = {};
      for (const name of new URLSearchParams(window.location.search).keys()) updates[name] = null;
      updates[SETUP_STEP_URL_KEY] = key;
      setParams(updates);
    },
    [setParams],
  );

  const mutation = useMutation({
    mutationKey: queryKeys.onboarding(),
    mutationFn: (body: OnboardingUpdate) => Services.onboarding.updateOnboarding(body),
    onSuccess: (record, body) => {
      queryClient.setQueryData(queryKeys.onboarding(), record);
      toast.success(
        body.confirm
          ? t("toasts.confirmed")
          : body.skip
            ? t("toasts.skipped")
            : t("toasts.unskipped"),
      );
    },
    onError: () => {
      toast.error(t("toasts.failed"));
    },
  });

  const header = (
    <Toolbar>
      <ToolbarHeading title={t("title")} description={t("description")} />
    </Toolbar>
  );

  function body() {
    if (!user || (canView && query.isPending)) return <Skeleton className="h-64 w-full" />;
    if (query.isError) {
      return (
        <LoadErrorCard
          message={t("loadFailed")}
          onRetry={() => {
            void query.refetch();
          }}
        />
      );
    }
    const record = query.data;
    if (!record || actionableSteps(record, user).length === 0) {
      if (record && isSetupFinished(record)) {
        return (
          <MessageCard
            title={t("finished.title")}
            description={t("finished.description")}
            action={
              <Button variant="outline" asChild>
                <Link href={Paths.DASHBOARD}>{t("finished.home")}</Link>
              </Button>
            }
          />
        );
      }
      return (
        <MessageCard title={t("nothingToDo.title")} description={t("nothingToDo.description")} />
      );
    }

    const steps = record.steps;
    const urlKey = searchParams.get(SETUP_STEP_URL_KEY);
    const active =
      steps.find((step) => step.key === urlKey) ??
      actionableSteps(record, user)[0] ??
      remainingSteps(record)[0] ??
      steps[0];
    if (!active) return null;
    const index = steps.indexOf(active);

    return (
      <div className="grid gap-5 lg:grid-cols-4 lg:gap-7.5">
        <div className="lg:col-span-1">
          <SetupStepNav steps={steps} activeKey={active.key} onSelect={goToStep} />
        </div>
        <div className="lg:col-span-3">
          {/* Keyed on the step, so each embedded section mounts fresh with the cleared URL. */}
          <SetupStepPanel
            key={active.key}
            step={active}
            user={user}
            previousKey={steps[index - 1]?.key}
            nextKey={steps[index + 1]?.key}
            onNavigate={goToStep}
            onUpdate={(body) => {
              mutation.mutate(body);
            }}
            isUpdating={mutation.isPending}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {header}
      {body()}
    </div>
  );
}
