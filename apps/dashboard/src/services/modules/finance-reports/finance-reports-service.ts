import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import type { JobAccepted } from "@/services/modules/jobs/jobs-service";
import {
  readClosingBalance,
  toFinanceReportParams,
  toFinanceReportQueryParams,
} from "./finance-reports-helper";
import type {
  FinanceReportQuery,
  FinanceReportRow,
  FinanceReportRun,
  ReportFormat,
  StudentStatement,
  StudentStatementEntry,
} from "./finance-reports-type";

/** The finance reports' API calls (`/reports/finance-summary`), reached through `Services.financeReports.*`. */

/**
 * Runs a report inline (`GET`, `fees.report.view`). Up to 1000 rows come back as `{kind, rows}`;
 * a larger report is a 422 whose `meta.row_limit` names the ceiling (`financeReportRowLimit`),
 * and is exported instead.
 */
export async function fetchReport(query: FinanceReportQuery): Promise<FinanceReportRun> {
  const { data } = await apiClient.get<FinanceReportRow[]>(endpoints.financeReports.summary, {
    query: toFinanceReportQueryParams(query),
  });
  return { kind: query.kind, rows: data };
}

/**
 * `POST`s the same parameters with a `format` (`fees.report.export`): always a `202` + a job whose
 * result is the file, polled through `Services.jobs`. The key is optional: a repeated export is a
 * second file, not a second effect.
 */
export async function exportReport(
  query: FinanceReportQuery,
  format: ReportFormat,
  idempotencyKey?: string,
): Promise<{ jobId: string }> {
  const body = { ...toFinanceReportParams(query), format };
  const { data } =
    idempotencyKey === undefined
      ? await apiClient.post<JobAccepted>(endpoints.financeReports.summary, body)
      : await apiClient.post<JobAccepted>(endpoints.financeReports.summary, body, {
          idempotencyKey,
        });
  return { jobId: data.job_id };
}

/**
 * One student's whole statement (`GET /students/{id}/ledger`, `fees.invoice.view`): the lines in
 * date order, each with the server's running balance, and `meta.closing_balance`. A student the
 * viewer cannot see, or from another school, is a 404.
 */
export async function fetchStudentStatement(studentId: string): Promise<StudentStatement> {
  const { data, meta } = await apiClient.get<StudentStatementEntry[]>(
    endpoints.financeReports.studentLedger(studentId),
  );
  return { entries: data, closingBalance: readClosingBalance(meta) };
}
