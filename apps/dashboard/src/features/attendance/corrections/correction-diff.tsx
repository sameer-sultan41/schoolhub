"use client";

import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";

import {
  AttendanceStatusBadge,
  isAnyAttendanceStatus,
} from "@/features/attendance/attendance-status";
import { EMPTY_VALUE } from "@/lib/constants";
import type { AttendanceCorrectionRecord, CorrectionChange } from "@/services";
import { correctionChanges } from "@/services/modules/attendance-corrections/attendance-corrections-helper";

/** Each field's label, reusing the request dialog's. */
const FIELD_LABEL: Record<CorrectionChange["field"], string> = {
  status: "correction.fields.status",
  check_in_time: "correction.fields.checkIn",
  check_out_time: "correction.fields.checkOut",
  remarks: "correction.fields.remarks",
};

/** A status (a student's or a staff member's) as its badge, any other value as text, and a blank
 * as a dash. */
function ChangeValue({ field, value }: { field: CorrectionChange["field"]; value: string | null }) {
  if (field === "status" && isAnyAttendanceStatus(value)) {
    return <AttendanceStatusBadge status={value} />;
  }
  return <span>{value ?? EMPTY_VALUE}</span>;
}

/**
 * What a correction would change, one line per field that differs: the record's value, then the
 * proposed one. A status shows as its badge (colour, icon and label), a time as `HH:MM`.
 */
export function CorrectionDiff({ correction }: { correction: AttendanceCorrectionRecord }) {
  const t = useTranslations("attendance");
  const changes = correctionChanges(correction);

  return (
    <ul className="space-y-1">
      {changes.map(({ field, from, to }) => (
        <li key={field} className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">{t(FIELD_LABEL[field])}</span>
          <ChangeValue field={field} value={from} />
          <ArrowRight className="size-3.5 shrink-0 rtl:rotate-180" aria-hidden="true" />
          <span className="sr-only">{t("corrections.diff.to")}</span>
          <ChangeValue field={field} value={to} />
        </li>
      ))}
    </ul>
  );
}
