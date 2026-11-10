"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardHeading,
  CardTitle,
  Skeleton,
} from "@schoolhub/ui";
import { CircleAlert, TriangleAlert } from "lucide-react";

import { LoadErrorCard } from "@/components/load-error-card";
import type { ExamConflict, SittingRecord } from "@/services";
import {
  formatSittingDate,
  hardFirst,
  isHardConflict,
  toShortTime,
} from "@/services/modules/exam-schedules/exam-schedules-helper";

export interface ConflictPanelProps {
  conflicts: readonly ExamConflict[];
  /** The exam's sittings, to name the ones a finding involves. */
  sittings: readonly SittingRecord[];
  isPending: boolean;
  /** The clash list couldn't be read; publishing stays held until it can be. */
  isError: boolean;
  onRetry: () => void;
}

/** A finding's label: translated by `type` when this app knows it, else the server's own message,
 * so a detector added server-side still says something useful. */
function useConflictLabel() {
  const t = useTranslations("exams");
  return (conflict: ExamConflict) =>
    t.has(`schedule.conflicts.types.${conflict.type}`)
      ? t(`schedule.conflicts.types.${conflict.type}`)
      : conflict.message;
}

/** A sitting's name where a finding lists it, in the viewer's language: paper, class and section,
 * the long date and the times, e.g. "Mathematics · Grade 5 A · Monday, October 5, 2026 · 09:00 to
 * 11:00". */
function useSittingLabel() {
  const t = useTranslations("exams");
  const locale = useLocale();
  return (sitting: SittingRecord) =>
    [
      sitting.subject_name,
      t("schedule.classSection", { class: sitting.class_name, section: sitting.section_name }),
      formatSittingDate(sitting.exam_date, locale),
      t("schedule.timeRange", {
        start: toShortTime(sitting.start_time),
        end: toShortTime(sitting.end_time),
      }),
    ].join(" · ");
}

/**
 * The exam's clash list, hard findings first (the server's order, kept within each severity). Each
 * finding is a severity badge (a word and an icon, never colour alone), a label, the server's
 * message (it names the room, the invigilator or the date) and the sittings it involves.
 */
export function ConflictPanel({
  conflicts,
  sittings,
  isPending,
  isError,
  onRetry,
}: ConflictPanelProps) {
  const t = useTranslations("exams");
  const labelFor = useConflictLabel();
  const sittingLabel = useSittingLabel();

  if (isError) {
    return <LoadErrorCard message={t("schedule.conflicts.loadError")} onRetry={onRetry} />;
  }

  if (isPending) {
    return (
      <div role="status">
        <span className="sr-only">{t("schedule.conflicts.title")}</span>
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const byId = new Map(sittings.map((sitting) => [sitting.id, sitting]));

  return (
    <Card>
      <CardHeader>
        <CardHeading>
          <CardTitle>{t("schedule.conflicts.title")}</CardTitle>
        </CardHeading>
      </CardHeader>
      <CardContent>
        {conflicts.length === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("schedule.conflicts.none")}
          </p>
        ) : (
          <ul aria-label={t("schedule.conflicts.title")} className="space-y-3">
            {hardFirst(conflicts).map((conflict) => {
              const isHard = isHardConflict(conflict);
              const Icon = isHard ? CircleAlert : TriangleAlert;
              const involved = conflict.schedule_ids
                .map((id) => byId.get(id))
                .filter((sitting): sitting is SittingRecord => sitting !== undefined);
              return (
                <li
                  key={`${conflict.type}-${conflict.schedule_ids.join("-")}`}
                  className="space-y-1 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Icon
                      className={isHard ? "size-4 text-danger" : "size-4 text-warning"}
                      aria-hidden="true"
                    />
                    <Badge variant={isHard ? "destructive" : "warning"} appearance="light">
                      {t(`schedule.conflicts.severity.${conflict.severity}`)}
                    </Badge>
                    <span className="font-medium text-foreground">{labelFor(conflict)}</span>
                  </div>
                  <p className="text-muted-foreground">{conflict.message}</p>
                  {involved.length > 0 && (
                    <ul
                      aria-label={t("schedule.conflicts.involves")}
                      className="list-disc ps-5 text-muted-foreground"
                    >
                      {involved.map((sitting) => (
                        <li key={sitting.id}>{sittingLabel(sitting)}</li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
