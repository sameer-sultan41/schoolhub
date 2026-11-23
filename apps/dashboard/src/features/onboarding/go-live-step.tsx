"use client";

import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Alert, AlertDescription, Button, Skeleton } from "@schoolhub/ui";

import { LoadErrorCard } from "@/components/load-error-card";
import { SESSION_KEYS } from "@/features/school/school-permissions";
import { SessionLifecycleDialog } from "@/features/school/sessions/session-lifecycle-dialog";
import { formatDate } from "@/lib/helpers";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type AcademicSessionRecord } from "@/services";
import { useCurrentUser } from "@/hooks/use-current-user";
import {
  PLANNED_SESSION_STATUS,
  SCHOOL_ORGANIZATION_QUERY_MODULE,
  SESSION_PAGE_RESOURCE,
  SESSION_PAGE_SIZE,
} from "@/services/modules/school-organization/school-organization-constant";

export interface GoLiveStepProps {
  /** A session is already active. */
  done: boolean;
  /** Opens the session step, for a school with nothing to activate yet. */
  onGoToSessions: () => void;
}

/**
 * The last step: activate a planned session (`:activate`) through the School module's own
 * activation dialog, which lists every structure gap at once if the school isn't ready. The read
 * sits under the School module's query key, so the dialog's own refresh updates this list too.
 */
export function GoLiveStep({ done, onGoToSessions }: GoLiveStepProps) {
  const t = useTranslations("onboarding");
  const tSchool = useTranslations("school");
  const locale = useLocale();
  const { data: user } = useCurrentUser();
  const [activating, setActivating] = useState<AcademicSessionRecord | null>(null);
  const headingId = useId();

  const query = useQuery({
    queryKey: queryKeys.list(SCHOOL_ORGANIZATION_QUERY_MODULE, SESSION_PAGE_RESOURCE, {
      status: PLANNED_SESSION_STATUS,
    }),
    queryFn: () =>
      Services.schoolOrganization.fetchSessionPage({
        status: PLANNED_SESSION_STATUS,
        pageSize: SESSION_PAGE_SIZE,
      }),
    enabled: !done,
  });

  if (done) {
    return (
      <Alert>
        <AlertDescription>{t("goLive.live")}</AlertDescription>
      </Alert>
    );
  }
  if (query.isError) {
    return (
      <LoadErrorCard
        message={t("goLive.loadFailed")}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  if (!query.data) return <Skeleton className="h-16 w-full" />;

  const sessions = query.data.items;
  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">{t("goLive.noSession")}</p>
        <Button variant="outline" onClick={onGoToSessions}>
          {t("goLive.toSession")}
        </Button>
      </div>
    );
  }

  const canActivate = hasPermission(user, SESSION_KEYS.activate);
  return (
    <section className="space-y-3" aria-labelledby={headingId}>
      <h3 id={headingId} className="text-sm font-medium">
        {t("goLive.planned")}
      </h3>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {sessions.map((session) => (
          <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div>
              <p className="font-medium">{session.name}</p>
              <p className="text-sm text-muted-foreground">
                {tSchool("sessions.range", {
                  start: formatDate(session.start_date, locale),
                  end: formatDate(session.end_date, locale),
                })}
              </p>
            </div>
            {canActivate && (
              <Button
                onClick={() => {
                  setActivating(session);
                }}
              >
                {t("goLive.activate", { name: session.name })}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {activating && (
        <SessionLifecycleDialog
          action="activate"
          session={activating}
          open
          onOpenChange={(open) => {
            if (!open) setActivating(null);
          }}
        />
      )}
    </section>
  );
}
