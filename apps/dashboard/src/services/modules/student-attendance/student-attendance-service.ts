import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import type { JobAccepted } from "@/services/modules/jobs/jobs-service";
import {
  toAttendanceMode,
  toAttendanceQueryParams,
  toBulkMarkBody,
  toBulkMarkMeta,
  toRegisterMeta,
} from "./student-attendance-helper";
import type {
  AttendancePageQuery,
  BulkMarkInput,
  BulkMarkResult,
  MyRegister,
  MyRegistersResult,
  RegisterEntry,
  RegisterQuery,
  RegisterResult,
  StudentAttendanceRecord,
} from "./student-attendance-type";

/** Student attendance's API calls (`/student-attendance`), reached through
 * `Services.studentAttendance.*`. */

/** One section's roster for a date, with each student's record, and the register's `meta`.
 * Not paged: the API answers one section whole. */
export async function fetchRegister(query: RegisterQuery): Promise<RegisterResult> {
  const { data, meta } = await apiClient.get<RegisterEntry[]>(
    endpoints.studentAttendance.register,
    {
      query: {
        section_id: query.sectionId,
        date: query.date,
        ...(query.periodId ? { period_id: query.periodId } : {}),
      },
    },
  );
  return { entries: data, meta: toRegisterMeta(meta) };
}

/** The registers the caller may take on `date` (one per section, or per section and period),
 * and the tenant's mode, which a marker without `school.settings.view` has no other way to read. */
export async function fetchMyRegisters(date: string): Promise<MyRegistersResult> {
  const { data, meta } = await apiClient.get<MyRegister[]>(
    endpoints.studentAttendance.myRegisters,
    { query: { date } },
  );
  return { registers: data, attendanceMode: toAttendanceMode(meta?.attendance_mode) };
}

/** One cursor page of attendance records. */
export async function fetchAttendancePage(
  query: AttendancePageQuery,
): Promise<Page<StudentAttendanceRecord>> {
  return fetchPage<StudentAttendanceRecord>(apiClient, endpoints.studentAttendance.list, {
    query: toAttendanceQueryParams(query),
  });
}

/** Submits a whole register; answers with the rows as written and the submission's counts.
 * The key makes a retry of the same submission a replay, so a caller makes a new one after
 * any edit. */
export async function bulkMark(
  input: BulkMarkInput,
  idempotencyKey: string,
): Promise<BulkMarkResult> {
  const { data, meta } = await apiClient.post<StudentAttendanceRecord[]>(
    endpoints.studentAttendance.bulkMark,
    toBulkMarkBody(input),
    { idempotencyKey },
  );
  return { records: data, meta: toBulkMarkMeta(meta) };
}

/** `POST /student-attendance-imports` (multipart) -> `202` + job: §9's historical import into
 * `academicSessionId` (required; never defaulted to the current session). A file over the size
 * cap is an `ApiError` from this call; bad rows come back in the job's `ImportJobResult`. */
export async function triggerAttendanceImport(
  file: File,
  academicSessionId: string,
): Promise<{ jobId: string }> {
  const body = new FormData();
  body.append("file", file);
  body.append("academic_session_id", academicSessionId);
  const { data } = await apiClient.post<JobAccepted>(endpoints.studentAttendance.imports, body);
  return { jobId: data.job_id };
}
