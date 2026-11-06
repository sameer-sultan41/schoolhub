import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import type { JobAccepted } from "@/services/modules/jobs/jobs-service";
import type { ReportFormat } from "@/services/shared/report-export";
import { toExamReportQueryParams } from "./exam-reports-helper";
import type { ExamReportQuery, ExamReportRow, ExamReportRun } from "./exam-reports-type";

/** Exam reports' API calls (`/reports/exam-summary`), reached through `Services.examReports.*`. */

/**
 * Runs a report. Up to 1000 rows come back inline as `{kind, rows}`; a larger one is a `202`
 * whose body is a job (`{jobId}`) building the same report as a CSV, polled through
 * `Services.jobs`. The body's shape tells the two apart: rows are a list, a job is not.
 */
export async function runReport(query: ExamReportQuery): Promise<ExamReportRun> {
  const { data } = await apiClient.get<ExamReportRow[] | JobAccepted>(
    endpoints.examReports.summary,
    { query: toExamReportQueryParams(query) },
  );
  return Array.isArray(data) ? { kind: query.kind, rows: data } : { jobId: data.job_id };
}

/** `POST` the same parameters with a `format`: always `202` + a job whose result is the file.
 * Needs `exams.result.export`. */
export async function exportReport(
  query: ExamReportQuery,
  format: ReportFormat,
): Promise<{ jobId: string }> {
  const { data } = await apiClient.post<JobAccepted>(endpoints.examReports.summary, {
    ...toExamReportQueryParams(query),
    format,
  });
  return { jobId: data.job_id };
}
