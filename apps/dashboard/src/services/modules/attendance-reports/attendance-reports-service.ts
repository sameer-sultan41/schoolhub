import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import type { JobAccepted } from "@/services/modules/jobs/jobs-service";
import { toAttendanceMode } from "@/services/modules/student-attendance/student-attendance-helper";
import { toReportQueryParams } from "./attendance-reports-helper";
import type {
  AttendanceReportRow,
  ReportFormat,
  ReportQuery,
  ReportRun,
} from "./attendance-reports-type";

/** Attendance reports' API calls (`/reports/attendance-summary`), reached through
 * `Services.attendanceReports.*`. */

/**
 * Runs a report. Up to 1000 rows come back inline as `{kind, rows}`; a larger one is a `202`
 * whose body is a job (`{jobId}`) building the same report as a CSV — poll it through
 * `Services.jobs` (its result carries `attendance_mode` too). The body's shape tells the two
 * apart: rows are a list, a job is not.
 */
export async function runReport(query: ReportQuery): Promise<ReportRun> {
  const { data, meta } = await apiClient.get<AttendanceReportRow[] | JobAccepted>(
    endpoints.attendanceReports.summary,
    { query: toReportQueryParams(query) },
  );
  return Array.isArray(data)
    ? { kind: query.kind, rows: data, attendanceMode: toAttendanceMode(meta?.attendance_mode) }
    : { jobId: data.job_id };
}

/** `POST` the same parameters with a `format`: always `202` + a job whose result is the file. */
export async function exportReport(
  query: ReportQuery,
  format: ReportFormat,
): Promise<{ jobId: string }> {
  const { data } = await apiClient.post<JobAccepted>(endpoints.attendanceReports.summary, {
    ...toReportQueryParams(query),
    format,
  });
  return { jobId: data.job_id };
}
