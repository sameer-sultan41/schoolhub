import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shapes (ADR-0017): every row carries its report's `kind` (ADR-0022). */
export type FinanceReportRow = ApiSchemas["FinanceReportRow"];
export type FinanceReportKind = ApiSchemas["FinanceReportQueryKindEnum"];
export type FinanceReportGroupBy = ApiSchemas["GroupByEnum"];
/** One line of a student's statement (`GET /students/{id}/ledger`): `kind` is the line's own type. */
export type StudentStatementEntry = ApiSchemas["StudentStatementEntry"];
/** The statement's `meta`: the line count and the server's closing balance. */
export type StudentStatementMeta = ApiSchemas["StudentLedgerMeta"];

/** A student's statement: the lines in date order and the closing balance the server computed. */
export interface StudentStatement {
  entries: StudentStatementEntry[];
  /** The last line's running balance as the server sent it; never summed on the client. */
  closingBalance: string;
}

/** Shared with every report module (`services/shared/report-export.ts`). */
export type { ReportFormat } from "@/services/shared/report-export";

/** The row type of one report, narrowed on its `kind`. */
export type FinanceReportRowOf<K extends FinanceReportKind> = Extract<
  FinanceReportRow,
  { kind: K }
>;

/**
 * A report's parameters, `date_from` and `date_to` always sent (the API requires both). The
 * optional ones are sent only for the kinds that take them (`FINANCE_REPORT_KIND_FIELDS`).
 */
export interface FinanceReportQuery {
  kind: FinanceReportKind;
  /** `YYYY-MM-DD`. */
  dateFrom: string;
  dateTo: string;
  /** `student-ledger` only, and required there. */
  studentId?: string;
  /** `collection` only. */
  groupBy?: FinanceReportGroupBy;
  campusId?: string;
  academicSessionId?: string;
  classId?: string;
}

/** An inline report: `rows` are all of one `kind`; `rowCount` is the server's `meta.row_count`. */
export interface FinanceReportRun {
  kind: FinanceReportKind;
  rows: FinanceReportRow[];
}

/** How a kind uses the date inputs: a from-to range, one "as of" date (the aging buckets and the
 * budget variance are measured at `date_to`), or none (the statement and the grant register are
 * not period-bounded, so the server ignores both dates). */
export type FinanceReportDates = "range" | "asOf" | "none";

/** Which inputs a report kind takes. */
export interface FinanceReportKindFields {
  dates: FinanceReportDates;
  /** The student the statement is for (required). */
  student: boolean;
  /** How `collection` groups its rows. */
  groupBy: boolean;
  campus: boolean;
  session: boolean;
  class: boolean;
}

/** The report form as the URL holds it (`FINANCE_REPORT_URL_FILTERS`), blanks as `""`. */
export interface FinanceReportFormValues {
  kind: string;
  from: string;
  to: string;
  student: string;
  group: string;
  campus: string;
  session: string;
  class: string;
}
