import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import type { JobAccepted } from "@/services/modules/jobs/jobs-service";
import { toFinanceReportParams, toFinanceReportQueryParams } from "./finance-reports-helper";
import type {
  FinanceReportQuery,
  FinanceReportRow,
  FinanceReportRun,
  ReportFormat,
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
