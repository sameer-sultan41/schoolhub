import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";

/**
 * `core.jobs`/`core.files` — the platform-level `202 + job` contract (api-architecture.md
 * §2.7–§2.8), not scoped to any one module. A caller kicks off a long-running operation
 * through its own module's trigger (e.g. `Services.staff.triggerStaffExport`), then
 * polls the returned job id through this file — see `@/hooks/use-job-polling`.
 */

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

/** The `202` body every job-starting trigger (`POST /<module>-imports`, `-exports`, …)
 * returns — a job to poll, not a result. */
export interface JobAccepted {
  job_id: string;
  status: JobStatus;
}

/** The subset of `BackgroundJobSerializer`'s fields (`apps/api/core/jobs/serializers.py`)
 * every caller needs. `result`'s real shape is module-specific — narrow it with
 * `ImportJobResult`/`ExportJobResult` below once `status` is `"succeeded"`. */
export interface BackgroundJobRecord {
  id: string;
  job_type: string;
  status: JobStatus;
  progress: number;
  result: Record<string, unknown> | null;
  error: string | null;
}

/** One failed row from a bulk import — `import_staff_row`'s return shape, verbatim
 * (`apps/api/apps/staff_management/staff/services/import_staff.py`). The student
 * import task returns the identical shape (`apps/api/apps/student_management/
 * tasks.py`), so this is shared, not staff-specific. */
export interface ImportRowError {
  /** The file's own row number, as a string — both importers return
   * `str(row_number)` (`dict[str, str]`), never a JSON number. Display it; don't do
   * arithmetic on it. */
  row: string;
  field: string;
  issue: string;
}

/** A finished import job's `result` — identical across every `import.<module>` task:
 * rows commit independently, so `failed > 0` alongside `succeeded > 0` is the normal
 * partial-success case, not an edge case. */
export interface ImportJobResult {
  total: number;
  succeeded: number;
  failed: number;
  errors: ImportRowError[];
}

/** A finished export job's `result` — `{result_file_id}`, the same shape every
 * `export.<module>` task returns (`mark_succeeded(job=job, result={"result_file_id":
 * ...})`). Pass `result_file_id` to `fetchFileDownloadUrl` for the actual URL. */
export interface ExportJobResult {
  result_file_id: string;
}

/** `GET /jobs/{id}` — the one poll a `useJobPolling` caller repeats until this reaches
 * a terminal status. */
export async function fetchJob(id: string): Promise<BackgroundJobRecord> {
  const { data } = await apiClient.get<BackgroundJobRecord>(endpoints.jobs.detail(id));
  return data;
}

/** `POST /files/{id}:download` — a signed, time-limited URL for a finished job's result
 * file (or any other `core.files` record). Not proxied: the browser navigates to this
 * URL directly, the same object-storage-URL pattern `files-service.ts`'s upload flow
 * already uses for `upload_url`. */
export async function fetchFileDownloadUrl(fileId: string): Promise<string> {
  const { data } = await apiClient.post<{ download_url: string }>(endpoints.files.download(fileId));
  return data.download_url;
}
