"use client";

import { useTranslations } from "next-intl";
import { Alert, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@schoolhub/ui";

import { Toolbar, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useUrlParams } from "@/hooks/use-url-params";
import { hasPermission } from "@/lib/permissions";
import {
  STAFF_URL_KEYS,
  STAFF_VIEW_HISTORY,
  STAFF_VIEW_REGISTER,
  type StaffView,
} from "@/services/modules/staff-attendance/staff-attendance-constant";
import { StaffRecordsTable } from "./staff-records-table";
import { StaffRegister } from "./staff-register";

/**
 * `/attendance/staff`. A holder of `attendance.staff-attendance.mark` gets two tabs, the
 * date-driven register (the default) and the history, the open one kept in the URL; anyone else
 * with the tab's view key gets the history alone, which the API scopes (a staff member's own
 * rows, for the usual own-scoped role).
 */
export function StaffAttendanceScreen() {
  const t = useTranslations("attendance");
  const tCommon = useTranslations("common");
  const { data: currentUser, isError } = useCurrentUser();
  const { searchParams, setParams } = useUrlParams();
  const canMark = hasPermission(currentUser, "attendance.staff-attendance.mark");
  const view: StaffView =
    searchParams.get(STAFF_URL_KEYS.view) === STAFF_VIEW_HISTORY
      ? STAFF_VIEW_HISTORY
      : STAFF_VIEW_REGISTER;

  function content() {
    // Which view to show depends on the viewer's keys.
    if (!currentUser) {
      if (isError) {
        return <Alert variant="destructive">{tCommon("permissionsLoadFailed")}</Alert>;
      }
      return (
        <div role="status" aria-busy="true">
          <span className="sr-only">{tCommon("permissionsLoading")}</span>
          <Skeleton className="h-96 w-full" />
        </div>
      );
    }
    if (!canMark) return <StaffRecordsTable />;
    return (
      <Tabs
        value={view}
        onValueChange={(value) => {
          // The register is the URL's default, so it leaves the key out.
          setParams({ [STAFF_URL_KEYS.view]: value === STAFF_VIEW_HISTORY ? value : null });
        }}
        className="space-y-4"
      >
        <TabsList variant="line" aria-label={t("staff.views.label")}>
          <TabsTrigger value={STAFF_VIEW_REGISTER}>{t("staff.views.register")}</TabsTrigger>
          <TabsTrigger value={STAFF_VIEW_HISTORY}>{t("staff.views.history")}</TabsTrigger>
        </TabsList>
        <TabsContent value={STAFF_VIEW_REGISTER}>
          <StaffRegister />
        </TabsContent>
        <TabsContent value={STAFF_VIEW_HISTORY}>
          <StaffRecordsTable />
        </TabsContent>
      </Tabs>
    );
  }

  return (
    <>
      <Toolbar>
        <ToolbarHeading
          title={t("staff.title")}
          description={currentUser && (canMark ? t("staff.summaryMark") : t("staff.summaryView"))}
        />
      </Toolbar>
      {content()}
    </>
  );
}
