"use client";

import { useTranslations } from "next-intl";
import { Skeleton } from "@schoolhub/ui";

import { Toolbar, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { LoadErrorCard } from "@/components/load-error-card";
import { SCHOOL_SETTINGS_UPDATE } from "@/features/school/school-permissions";
import { useCurrentUser } from "@/hooks/use-current-user";
import { resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import { HolidaysCard } from "./holidays-card";
import { useHolidayCalendar } from "./use-holiday-calendar";
import { WorkingDaysCard, workingDaysKey } from "./working-days-card";

/**
 * The Calendar section as one unit: the school's working week and its holidays
 * (`/holiday-calendar`, which attendance marks against). Editing needs
 * `school.settings.update`; without it both read only.
 */
export function CalendarSection() {
  const t = useTranslations("school");
  const tErrors = useTranslations("errors");
  const { data: currentUser } = useCurrentUser();
  const canEdit = hasPermission(currentUser, SCHOOL_SETTINGS_UPDATE);
  const query = useHolidayCalendar();

  function body() {
    if (query.data) {
      return (
        <div className="space-y-5">
          <WorkingDaysCard
            key={workingDaysKey(query.data.working_days)}
            workingDays={query.data.working_days}
            canEdit={canEdit}
          />
          <HolidaysCard holidays={query.data.holidays} canEdit={canEdit} />
        </div>
      );
    }
    if (query.isError) {
      return (
        <LoadErrorCard
          message={resolveErrorMessage(query.error, tErrors, t("calendar.loadError"))}
          onRetry={() => {
            void query.refetch();
          }}
        />
      );
    }
    return (
      <div role="status" aria-busy="true">
        <span className="sr-only">{t("calendar.loading")}</span>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Toolbar>
        <ToolbarHeading title={t("calendar.title")} description={t("calendar.summary")} />
      </Toolbar>
      {body()}
    </div>
  );
}
