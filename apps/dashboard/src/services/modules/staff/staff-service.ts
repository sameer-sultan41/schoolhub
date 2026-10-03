import { fetchPage, type Page } from "@schoolhub/api-client";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { MAX_PAGE_SIZE } from "./staff-constant";
import { toStaffCreateBody, toStaffQueryParams, toStaffUpdateBody } from "./staff-helper";
import type {
  CreateStaffInput,
  ExitStaffInput,
  StaffDetailRecord,
  StaffDirectoryQuery,
  StaffDirectoryRecord,
  UpdateStaffInput,
} from "./staff-type";

export type {
  CreateStaffInput,
  ExitStaffInput,
  StaffDetailRecord,
  StaffDirectoryQuery,
  StaffDirectoryRecord,
  UpdateStaffInput,
} from "./staff-type";

/**
 * The staff domain's API calls. Every consumer reaches these through
 * `Services.staff.*` (see `@/services`) — never by importing this file directly and
 * never by importing `@schoolhub/api-client` directly.
 */

/**
 * Every staff member, up to one page. `/staff` is page-number paginated, not cursor —
 * `collectPages` only walks cursors, so it silently returned page one only; this reads
 * one large page directly instead. A school with more than 100 staff loses the rest for
 * now, same trade-off `PENDING_PREVIEW_SIZE`-style caps make elsewhere in this app.
 */
export async function fetchStaffDirectory(): Promise<StaffDirectoryRecord[]> {
  const { items } = await fetchPage<StaffDirectoryRecord>(apiClient, endpoints.dashboard.staff, {
    query: { page_size: MAX_PAGE_SIZE },
  });
  return items;
}

/**
 * One page of the staff directory, server-paginated/sorted/searched — the `/staff`
 * page's own fetch, distinct from `fetchStaffDirectory`'s fixed one-page preview (used
 * by the dashboard-home Teams widget, which never changes page/search/sort). `search`
 * and `ordering` are passed straight through to `/staff`'s own DRF `SearchFilter`/
 * `OrderingFilter` — confirmed fields, `apps/api/apps/staff_management/views.py`'s
 * `search_fields`/`ordering_fields` — never invented client-side. `employmentStatus`
 * is sent as `employment_status`, `/staff`'s real exact-match filter.
 */
export async function fetchStaffPage(
  query: StaffDirectoryQuery = {},
): Promise<Page<StaffDirectoryRecord>> {
  return fetchPage<StaffDirectoryRecord>(apiClient, endpoints.dashboard.staff, {
    query: toStaffQueryParams(query),
  });
}

/**
 * Real headcount for one `staff_type`, for the `/staff` toolbar's "Teaching Staff"
 * stat — same single-`page_size: 1`-request, read-`total_count` pattern
 * `dashboard-service.ts`'s own `fetchTotal` uses, but scoped to one `staff_type`
 * rather than an unfiltered endpoint. `null` means the endpoint didn't report a
 * total — never a fabricated zero.
 */
export async function fetchStaffTypeCount(
  staffType: "teaching" | "non_teaching",
): Promise<number | null> {
  const page = await fetchPage<{ id: string }>(apiClient, endpoints.dashboard.staff, {
    query: { staff_type: staffType, page_size: 1 },
  });
  const pagination = page.pagination;
  if (!pagination || !("total_count" in pagination)) return null;
  return pagination.total_count ?? null;
}

/** `POST /staff` — creates one staff record. */
export async function createStaff(input: CreateStaffInput): Promise<StaffDirectoryRecord> {
  const { data } = await apiClient.post<StaffDirectoryRecord>(
    endpoints.dashboard.staff,
    toStaffCreateBody(input),
  );
  return data;
}

/** `PATCH /staff/{id}` — a plain generic `ModelViewSet` partial update. */
export async function updateStaff(
  id: string,
  input: UpdateStaffInput,
): Promise<StaffDirectoryRecord> {
  const { data } = await apiClient.patch<StaffDirectoryRecord>(
    endpoints.dashboard.staffDetail(id),
    toStaffUpdateBody(input),
  );
  return data;
}

export async function exitStaff(id: string, input: ExitStaffInput): Promise<StaffDirectoryRecord> {
  const { data } = await apiClient.post<StaffDirectoryRecord>(endpoints.dashboard.staffExit(id), {
    exit_date: input.exitDate,
    exit_reason: input.exitReason,
    ...(input.exitType ? { exit_type: input.exitType } : {}),
  });
  return data;
}

/** `GET /staff/{id}` — the one full staff record, for the edit form's pre-fill. */
export async function fetchStaffById(id: string): Promise<StaffDetailRecord> {
  const { data } = await apiClient.get<StaffDetailRecord>(endpoints.dashboard.staffDetail(id));
  return data;
}

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
 * `StaffImportDialog`. */
export async function triggerStaffImport(file: File): Promise<{ jobId: string }> {
  const body = new FormData();
  body.append("file", file);
  const { data } = await apiClient.post<{ job_id: string; status: string }>(
    endpoints.dashboard.staffImports,
    body,
  );
  return { jobId: data.job_id };
}
