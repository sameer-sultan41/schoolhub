"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Alert, EmptyState, Input, Skeleton } from "@schoolhub/ui";
import { Users } from "lucide-react";

import { LoadErrorCard } from "@/components/load-error-card";
import { RequestCorrectionDialog } from "@/features/attendance/request-correction-dialog";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useUrlParams } from "@/hooks/use-url-params";
import { resolveErrorMessage } from "@/lib/error-message";
import { formatDate, isIsoDate, todayIsoDate } from "@/lib/helpers";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type StaffAttendanceRecord, type StaffRegisterEntry } from "@/services";
import {
  STAFF_ATTENDANCE_LIST_RESOURCE,
  STAFF_ATTENDANCE_QUERY_MODULE,
  STAFF_REGISTER_RESOURCE,
  STAFF_URL_KEYS,
} from "@/services/modules/staff-attendance/staff-attendance-constant";
import { withSavedStaffRecord } from "@/services/modules/staff-attendance/staff-attendance-helper";
import { CheckOutDialog } from "./check-out-dialog";
import { StaffRegisterRow } from "./staff-register-row";

/** The query key of one date's staff register; a save writes its row into it. */
export function staffRegisterQueryKey(date: string) {
  return queryKeys.list(STAFF_ATTENDANCE_QUERY_MODULE, STAFF_REGISTER_RESOURCE, { date });
}

/**
 * The staff register for a date (today unless the URL says otherwise): every active staff
 * member the viewer may mark, each row saved on its own. A future date is read-only, as the
 * server refuses it; any other refusal (a holiday, a locked row) comes back on the row.
 */
export function StaffRegister() {
  const t = useTranslations("attendance");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { data: currentUser } = useCurrentUser();
  const canCorrect = hasPermission(currentUser, "attendance.correction.create");
  const { searchParams, setParams } = useUrlParams();
  const dateParam = searchParams.get(STAFF_URL_KEYS.date) ?? "";
  const today = todayIsoDate();
  const date = isIsoDate(dateParam) ? dateParam : today;
  // ISO dates order as the days do.
  const isFuture = date > today;
  const queryKey = staffRegisterQueryKey(date);

  const query = useQuery({
    queryKey,
    queryFn: () => Services.staffAttendance.fetchStaffRegister({ date }),
  });
  const [checkingOut, setCheckingOut] = useState<StaffAttendanceRecord | null>(null);
  const [correcting, setCorrecting] = useState<StaffAttendanceRecord | null>(null);

  function handleSaved(record: StaffAttendanceRecord) {
    queryClient.setQueryData<StaffRegisterEntry[]>(queryKey, (current) =>
      current ? withSavedStaffRecord(current, record) : current,
    );
    // The history holds this row too.
    void queryClient.invalidateQueries({
      queryKey: queryKeys.list(STAFF_ATTENDANCE_QUERY_MODULE, STAFF_ATTENDANCE_LIST_RESOURCE),
    });
  }

  function reload() {
    void queryClient.invalidateQueries({ queryKey });
  }

  function body() {
    // Data first: a failed reload must not take away rows being marked.
    if (query.data) {
      const entries = query.data;
      const lockedRows = entries.some((entry) => entry.record?.is_locked);
      return (
        <section
          aria-label={t("staff.register.label", { date: formatDate(date, locale) })}
          className="rounded-xl border border-border bg-card"
        >
          {(isFuture || lockedRows) && (
            <div className="space-y-3 p-4">
              {isFuture && (
                <Alert variant="info" appearance="light">
                  {t("register.unmarkable.future")}
                </Alert>
              )}
              {!isFuture && lockedRows && (
                <Alert variant="info" appearance="light">
                  {canCorrect ? t("register.lockedRowsCorrect") : t("register.lockedRows")}
                </Alert>
              )}
            </div>
          )}
          {entries.length === 0 ? (
            <EmptyState
              icon={Users}
              title={t("staff.register.emptyTitle")}
              description={t("staff.register.empty")}
            />
          ) : (
            <ul aria-label={t("staff.register.listLabel")} className="divide-y divide-border">
              {entries.map((entry) => (
                <StaffRegisterRow
                  // Another date is a fresh row; a new record for the same one is merged into it.
                  key={`${date}:${entry.staff_id}`}
                  entry={entry}
                  date={date}
                  readOnly={isFuture}
                  onSaved={handleSaved}
                  onLocked={reload}
                  onCheckOut={setCheckingOut}
                  onRequestCorrection={canCorrect ? setCorrecting : undefined}
                />
              ))}
            </ul>
          )}
        </section>
      );
    }
    if (query.isError) {
      return (
        <LoadErrorCard
          message={resolveErrorMessage(query.error, tErrors, t("staff.register.loadError"))}
          onRetry={() => {
            void query.refetch();
          }}
        />
      );
    }
    return (
      <div role="status" aria-busy="true">
        <span className="sr-only">{t("staff.register.loading")}</span>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Input
        type="date"
        value={date}
        aria-label={t("register.fields.date")}
        className="w-full sm:w-44"
        onChange={(event) => {
          const value = event.target.value;
          // A cleared date goes back to today, the URL's default.
          setParams({ [STAFF_URL_KEYS.date]: isIsoDate(value) ? value : null });
        }}
      />
      {body()}
      {checkingOut && (
        <CheckOutDialog
          open
          onOpenChange={(open) => {
            if (!open) setCheckingOut(null);
          }}
          record={checkingOut}
          onCheckedOut={handleSaved}
          onLocked={reload}
        />
      )}
      {correcting && (
        <RequestCorrectionDialog
          open
          onOpenChange={(open) => {
            if (!open) setCorrecting(null);
          }}
          target={{ kind: "staff", record: correcting }}
        />
      )}
    </div>
  );
}
