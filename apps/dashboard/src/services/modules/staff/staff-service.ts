import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";

/**
 * New staff-module API calls land here, per ADR-0011 ("staff calls belong in
 * services/modules/staff/, not in Services.dashboard"). The pre-existing staff calls
 * in `services/modules/dashboard/dashboard-service.ts` (`fetchStaffPage`,
 * `createStaff`, etc.) are that ADR's own already-tracked drift — moving them is a
 * separate, unrelated migration, not part of wiring up two new buttons.
 */

/** `POST /staff-exports` -> `202` + job (module doc §16). The job's `result` on
 * success is `ExportJobResult` (`@/services/modules/jobs/jobs-service`) — pass its
 * `result_file_id` to `Services.jobs.fetchFileDownloadUrl` for the actual download
 * URL. */
export async function triggerStaffExport(): Promise<{ jobId: string }> {
  const { data } = await apiClient.post<{ job_id: string; status: string }>(
    endpoints.dashboard.staffExports,
  );
  return { jobId: data.job_id };
}

/** `POST /staff-imports` (multipart) -> `202` + job. `file` must be `.csv` or
 * `.xlsx`, capped server-side at 5 MB
 * (`apps/api/apps/staff_management/staff/viewset.py`) — a file outside those limits
 * comes back as a real `ApiError` from THIS call. A file that parses but whose rows
 * fail comes back as a `"failed"` job instead (see `ImportJobResult`) — the two
 * failure modes are genuinely different and are handled separately by
 * `StaffImportDialog` (Task 4). */
export async function triggerStaffImport(file: File): Promise<{ jobId: string }> {
  const body = new FormData();
  body.append("file", file);
  const { data } = await apiClient.post<{ job_id: string; status: string }>(
    endpoints.dashboard.staffImports,
    body,
  );
  return { jobId: data.job_id };
}
