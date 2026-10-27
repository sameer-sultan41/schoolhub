import type { ApiSchemas } from "@schoolhub/api-client";
import type { AttendanceMode } from "@/services/modules/attendance-settings/attendance-settings-type";

/** The generated wire shapes (ADR-0017): every row carries its report's `kind` (ADR-0022). */
export type AttendanceReportRow = ApiSchemas["AttendanceReportRow"];
export type ReportKind = ApiSchemas["AttendanceReportQueryKindEnum"];
export type ReportFormat = ApiSchemas["FormatEnum"];

/** The row type of one report, narrowed on its `kind`. */
export type ReportRowOf<K extends ReportKind> = Extract<AttendanceReportRow, { kind: K }>;

/** A report's parameters. `endDate` is left out for the single-day `daily-register`; the rest
 * are sent only for the kinds that use them (`REPORT_KIND_FIELDS`). */
export interface ReportQuery {
  kind: ReportKind;
  /** `YYYY-MM-DD`. */
  startDate: string;
  endDate?: string;
  sectionId?: string;
  /** `daily-register` only: one period's own rows instead of the derived day. */
  periodId?: string;
  /** `defaulters` only: a percentage, at most one decimal place. */
  threshold?: string;
}

/** A report small enough to come back inline (≤ 1000 rows). */
export interface InlineReport {
  kind: ReportKind;
  rows: AttendanceReportRow[];
  /** How the tenant marks attendance (`meta.attendance_mode`): a period view exists only in
   * period mode. */
  attendanceMode: AttendanceMode;
}

/** A report too large to return inline: the server built it as a CSV job instead. */
export interface QueuedReport {
  jobId: string;
}

export type ReportRun = InlineReport | QueuedReport;

/** Which inputs a report kind takes. */
export interface ReportKindFields {
  /** One date rather than a range. */
  singleDate: boolean;
  /** Narrowed to one section (the student reports). */
  section: boolean;
  /** Narrowed to one period's own rows. */
  period: boolean;
  /** A rate below which a student is listed. */
  threshold: boolean;
}

/** The report form as the URL holds it (`REPORT_URL_FILTERS`), blanks as `""`. */
export interface ReportFormValues {
  kind: string;
  from: string;
  to: string;
  sectionId: string;
  periodId: string;
  threshold: string;
}
