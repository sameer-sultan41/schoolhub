"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Alert, EmptyState, Skeleton } from "@schoolhub/ui";
import { Users } from "lucide-react";

import { LoadErrorCard } from "@/components/load-error-card";
import { RequestCorrectionDialog } from "@/features/attendance/request-correction-dialog";
import { useCurrentUser } from "@/hooks/use-current-user";
import { foldUnknownFieldErrors, NON_FIELD, resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import {
  ApiError,
  Services,
  type BulkMarkInput,
  type RegisterMeta,
  type RegisterResult,
  type StudentAttendanceRecord,
} from "@/services";
import {
  MY_REGISTERS_RESOURCE,
  REGISTER_RESOURCE,
  STUDENT_ATTENDANCE_QUERY_MODULE,
} from "@/services/modules/student-attendance/student-attendance-constant";
import {
  entryIssuesFromError,
  rowIssuesFromError,
  withSavedRecords,
} from "@/services/modules/student-attendance/student-attendance-helper";
import { RegisterRow } from "./register-row";
import { RegisterSummary } from "./register-summary";
import { useRegisterForm } from "./use-register-form";

export interface RegisterTableProps {
  sectionId: string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** `""` for a daily register. */
  periodId: string;
  /** The register's name (class, section and period), when the screen knows it. */
  heading?: string;
}

/** The query key of one register; a submission writes its saved rows into it. */
export function registerQueryKey({ sectionId, date, periodId }: RegisterTableProps) {
  return queryKeys.list(STUDENT_ATTENDANCE_QUERY_MODULE, REGISTER_RESOURCE, {
    sectionId,
    date,
    periodId,
  });
}

/**
 * One register: a section's roster for a date (and period), marked and submitted whole. The
 * caller keys it by section, date and period, so a different register starts a fresh grid and
 * a fresh idempotency key; a reload of the same one keeps every choice still editable.
 */
export function RegisterTable(props: RegisterTableProps) {
  const t = useTranslations("attendance");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: registerQueryKey(props),
    queryFn: () =>
      Services.studentAttendance.fetchRegister({
        sectionId: props.sectionId,
        date: props.date,
        periodId: props.periodId || undefined,
      }),
  });

  // Data first: a failed reload must not take away a register being marked.
  if (query.data) return <RegisterBody {...props} register={query.data} />;
  if (query.isError) {
    const error = query.error;
    // A register the viewer may not mark is a 404 (never "forbidden"); a 422 names its field
    // (a period in the wrong mode, a break, a period with no lesson that day).
    const isMissing = error instanceof ApiError && error.isNotFound;
    return (
      <LoadErrorCard
        message={resolveErrorMessage(
          isMissing ? error : foldUnknownFieldErrors(error),
          tErrors,
          t("register.loadError"),
          isMissing ? undefined : NON_FIELD,
        )}
        onRetry={() => {
          // A period refused for the mode means My registers' mode is stale (the setting changed
          // in another tab): re-read it, so the screen asks for the register the right way.
          if (error instanceof ApiError && "period_id" in error.fieldErrors()) {
            void queryClient.invalidateQueries({
              queryKey: queryKeys.list(STUDENT_ATTENDANCE_QUERY_MODULE, MY_REGISTERS_RESOURCE),
            });
          }
          void query.refetch();
        }}
      />
    );
  }
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{t("register.loading")}</span>
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

/** The read-only reason for a date that can't be marked (`meta.unmarkable_reason`). */
function useUnmarkableText() {
  const t = useTranslations("attendance");
  return (meta: RegisterMeta) => {
    switch (meta.unmarkableReason) {
      case "holiday":
        return t("register.unmarkable.holiday", { name: meta.holidayName ?? "" });
      case "future":
      case "non_working_day":
      case "session_closed":
        return t(`register.unmarkable.${meta.unmarkableReason}`);
      default:
        return t("register.unmarkable.unknown");
    }
  };
}

type Notice = { kind: "error" | "locked"; text: string };

function RegisterBody({
  register,
  heading,
  ...params
}: RegisterTableProps & { register: RegisterResult }) {
  const t = useTranslations("attendance");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const { data: currentUser } = useCurrentUser();
  const unmarkableText = useUnmarkableText();
  const { meta, entries } = register;
  const form = useRegisterForm(entries, meta.markable);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [correcting, setCorrecting] = useState<StudentAttendanceRecord | null>(null);
  const canCorrect = hasPermission(currentUser, "attendance.correction.create");
  const queryKey = registerQueryKey(params);

  const errorText = (error: unknown) =>
    resolveErrorMessage(foldUnknownFieldErrors(error), tErrors, tCommon("submitFailed"), NON_FIELD);

  const submit = useMutation({
    mutationFn: ({ input, key }: { input: BulkMarkInput; key: string }) =>
      Services.studentAttendance.bulkMark(input, key),
    onSuccess: ({ records, meta: counts }) => {
      queryClient.setQueryData<RegisterResult>(queryKey, (current) =>
        current ? withSavedRecords(current, records) : current,
      );
      form.markSaved();
      toast.success(
        t("register.saved", {
          marked: counts.marked,
          updated: counts.updated,
          alerts: counts.alertsQueued,
        }),
      );
      void queryClient.invalidateQueries({
        queryKey: queryKeys.module(STUDENT_ATTENDANCE_QUERY_MODULE),
      });
    },
    onError: (error, { input }) => {
      // The rows the server refused, each with its own sentence; every other choice stays.
      const issues = rowIssuesFromError(error);
      const sent = input.entries.map((entry) => entry.studentId);
      form.setIssues(new Map([...entryIssuesFromError(error, sent), ...issues]));
      if (error instanceof ApiError && error.status === 409) {
        // Locked rows are named by no one: reload, and they come back read-only.
        setNotice({
          kind: "locked",
          text: t("register.lockedReloaded", { message: error.message }),
        });
        void queryClient.invalidateQueries({ queryKey });
        return;
      }
      setNotice({ kind: "error", text: errorText(error) });
      // A refused row is a roster that moved since it loaded (a student left the section, or
      // leave was approved): the reload drops or shows them, so the rest can be sent again.
      if (issues.size > 0) void queryClient.invalidateQueries({ queryKey });
    },
  });

  function handleSubmit() {
    if (!form.canSubmit || submit.isPending) return;
    setNotice(null);
    form.setIssues(new Map());
    submit.mutate({
      key: form.idempotencyKey,
      input: {
        sectionId: params.sectionId,
        attendanceDate: params.date,
        periodId: params.periodId || null,
        academicSessionId: meta.academicSessionId ?? undefined,
        entries: form.buildEntries(),
      },
    });
  }

  const lockedRows = form.rows.some((row) => row.mode === "locked");

  return (
    <section
      aria-label={heading ?? t("register.title")}
      className="rounded-xl border border-border bg-card"
    >
      <div className="space-y-3 p-4">
        {heading && <h2 className="text-base font-semibold">{heading}</h2>}
        {notice && (
          <Alert variant={notice.kind === "locked" ? "warning" : "destructive"}>
            {notice.text}
          </Alert>
        )}
        {!meta.markable && (
          <Alert variant="info" appearance="light">
            {unmarkableText(meta)}
          </Alert>
        )}
        {meta.markable && lockedRows && (
          <Alert variant="info" appearance="light">
            {canCorrect ? t("register.lockedRowsCorrect") : t("register.lockedRows")}
          </Alert>
        )}
      </div>
      {entries.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t("register.emptyTitle")}
          description={t("register.empty")}
        />
      ) : (
        <ul
          aria-label={t("register.listLabel")}
          className="divide-y divide-border border-t border-border"
        >
          {form.rows.map((row) => (
            <RegisterRow
              key={row.entry.student_id}
              row={row}
              onEdit={form.editRow}
              onRequestCorrection={canCorrect ? setCorrecting : undefined}
              disabled={submit.isPending}
            />
          ))}
        </ul>
      )}
      <RegisterSummary
        counts={form.counts}
        showActions={meta.markable && form.editableCount > 0}
        unmarkedEditable={form.unmarkedEditable}
        canSubmit={form.canSubmit}
        isSubmitting={submit.isPending}
        onMarkAllPresent={form.markAllPresent}
        onSubmit={handleSubmit}
      />
      {correcting && (
        <RequestCorrectionDialog
          open
          onOpenChange={(open) => {
            if (!open) setCorrecting(null);
          }}
          target={{ kind: "student", record: correcting }}
        />
      )}
    </section>
  );
}
