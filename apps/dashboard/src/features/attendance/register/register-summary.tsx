"use client";

import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";
import { CheckCheck } from "lucide-react";

import type { AttendanceStatus } from "@/services";
import { ATTENDANCE_STATUSES } from "@/services/modules/student-attendance/student-attendance-constant";
import type { RegisterCounts } from "./use-register-form";

/** Shown even at zero, so the summary always reads "Present n … Unmarked n"; every other status
 * shows only once a row has it, which keeps a typical day's footer short. */
const ALWAYS_SHOWN: ReadonlySet<AttendanceStatus> = new Set(["present"]);

export interface RegisterSummaryProps {
  counts: RegisterCounts;
  /** False when nothing on the register can be sent (a read-only date, every row locked). */
  showActions: boolean;
  unmarkedEditable: number;
  canSubmit: boolean;
  isSubmitting: boolean;
  onMarkAllPresent: () => void;
  onSubmit: () => void;
}

/**
 * The register's footer, kept in view while the list scrolls: a count per status (present
 * always, the others once non-zero) and unmarked, **Mark all present** and **Submit**. Submit
 * waits until every row that will be sent has a status.
 */
export function RegisterSummary({
  counts,
  showActions,
  unmarkedEditable,
  canSubmit,
  isSubmitting,
  onMarkAllPresent,
  onSubmit,
}: RegisterSummaryProps) {
  const t = useTranslations("attendance");
  const shownStatuses = ATTENDANCE_STATUSES.filter(
    (status) => ALWAYS_SHOWN.has(status) || counts[status] > 0,
  );
  const counted = [
    ...shownStatuses.map((status) => ({ key: status, label: t(`status.${status}`) })),
    { key: "unmarked" as const, label: t("register.counts.unmarked") },
  ];

  return (
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t border-border bg-card p-4">
      <section aria-label={t("register.counts.label")}>
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {counted.map(({ key, label }) => (
            <div key={key} className="flex gap-1">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-semibold tabular-nums">{counts[key].toLocaleString()}</dd>
            </div>
          ))}
        </dl>
      </section>
      {showActions && (
        <div className="flex flex-wrap items-center gap-2">
          {unmarkedEditable > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("register.unmarkedLeft", { count: unmarkedEditable })}
            </p>
          )}
          <Button
            variant="outline"
            disabled={unmarkedEditable === 0 || isSubmitting}
            onClick={onMarkAllPresent}
          >
            <CheckCheck aria-hidden="true" />
            {t("register.markAllPresent")}
          </Button>
          <Button
            disabled={!canSubmit}
            isLoading={isSubmitting}
            loadingLabel={t("register.submitting")}
            onClick={onSubmit}
          >
            {t("register.submit")}
          </Button>
        </div>
      )}
    </div>
  );
}
