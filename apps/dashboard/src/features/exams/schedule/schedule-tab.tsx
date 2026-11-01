"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button, EmptyState, Skeleton } from "@schoolhub/ui";
import { CalendarDays, Plus } from "lucide-react";

import { LoadErrorCard } from "@/components/load-error-card";
import { useCurrentUser } from "@/hooks/use-current-user";
import { resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type ExamConflict, type ExamRecord } from "@/services";
import {
  EXAM_SCHEDULES_QUERY_MODULE,
  SCHEDULE_CONFLICTS_RESOURCE,
} from "@/services/modules/exam-schedules/exam-schedules-constant";
import {
  conflictsBySitting,
  groupByDate,
  hardConflictCount,
  isSchedulePublishable,
} from "@/services/modules/exam-schedules/exam-schedules-helper";
import { isExamConfigurable, isExamDeletable } from "@/services/modules/exams/exams-helper";
import { useExamSittings } from "@/features/exams/use-exam-sittings";
import { ConflictPanel } from "./conflict-panel";
import { PublishScheduleButton } from "./publish-schedule-button";
import { ScheduleTable } from "./schedule-table";
import { SittingFormDialog } from "./sitting-form-dialog";

const NO_CONFLICTS: readonly ExamConflict[] = [];

/**
 * The exam's Schedule tab: its sittings by date, the clash list (read fresh from the server, hard
 * findings first) and Publish schedule. Every sitting write, and a publish, invalidates the exam's
 * reads, so the table and the panel reload together from the server. Add and reschedule need
 * `exams.schedule.create` / `.update` and an exam still up to `scheduled`; cancelling needs only
 * `.update`; deleting needs `.update` on a draft exam; Publish schedule needs `.update` and a
 * draft or scheduled exam.
 */
export function ScheduleTab({ exam }: { exam: ExamRecord }) {
  const t = useTranslations("exams");
  const tErrors = useTranslations("errors");
  const [addOpen, setAddOpen] = useState(false);

  const { data: user } = useCurrentUser();
  const configurable = isExamConfigurable(exam.status);
  const canUpdate = hasPermission(user, "exams.schedule.update");
  const canAdd = hasPermission(user, "exams.schedule.create") && configurable;
  const canEdit = canUpdate && configurable;
  const canDelete = canUpdate && isExamDeletable(exam.status);
  const canPublish = canUpdate && isSchedulePublishable(exam.status);

  const sittingsQuery = useExamSittings(exam.id);
  const conflictsQuery = useQuery({
    queryKey: queryKeys.list(EXAM_SCHEDULES_QUERY_MODULE, SCHEDULE_CONFLICTS_RESOURCE, {
      examId: exam.id,
    }),
    queryFn: () => Services.examSchedules.fetchConflicts(exam.id),
  });

  const conflicts = conflictsQuery.data ?? NO_CONFLICTS;
  const sittings = sittingsQuery.data;
  const days = useMemo(() => groupByDate(sittings ?? []), [sittings]);
  const clashes = useMemo(() => conflictsBySitting(conflicts), [conflicts]);

  if (sittingsQuery.isError) {
    return (
      <LoadErrorCard
        message={resolveErrorMessage(sittingsQuery.error, tErrors, t("schedule.loadError"))}
        onRetry={() => {
          void sittingsQuery.refetch();
        }}
      />
    );
  }

  if (!sittings) {
    return (
      <div role="status" className="space-y-3">
        <span className="sr-only">{t("schedule.title")}</span>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const showToolbar = canAdd || canPublish;

  return (
    <div className="space-y-5">
      {showToolbar && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {canAdd ? (
            <Button
              variant="primary"
              onClick={() => {
                setAddOpen(true);
              }}
            >
              <Plus aria-hidden="true" />
              {t("schedule.actions.add")}
            </Button>
          ) : (
            <span />
          )}
          {canPublish && sittings.length > 0 && (
            <PublishScheduleButton
              exam={exam}
              hardCount={hardConflictCount(conflicts)}
              isChecking={!conflictsQuery.isSuccess}
            />
          )}
        </div>
      )}
      {(sittings.length > 0 || conflicts.length > 0) && (
        <ConflictPanel
          conflicts={conflicts}
          sittings={sittings}
          isPending={conflictsQuery.isPending}
          isError={conflictsQuery.isError}
          onRetry={() => {
            void conflictsQuery.refetch();
          }}
        />
      )}
      {days.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={t("schedule.emptyTitle")}
          description={t(canAdd ? "schedule.emptyDescription" : "schedule.emptyReadOnly")}
        />
      ) : (
        <ScheduleTable
          exam={exam}
          days={days}
          conflictsBySitting={clashes}
          canEdit={canEdit}
          canCancel={canUpdate}
          canDelete={canDelete}
        />
      )}
      {addOpen && <SittingFormDialog open onOpenChange={setAddOpen} exam={exam} />}
    </div>
  );
}
