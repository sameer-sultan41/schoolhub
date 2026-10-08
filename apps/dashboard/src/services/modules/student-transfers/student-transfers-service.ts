import { fetchPage, MAX_PAGE_SIZE } from "@schoolhub/api-client";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import type {
  CompleteTransferInput,
  RequestTransferInput,
  StudentTransferRecord,
} from "./student-transfers-type";

/**
 * The student-transfers domain's API calls. Every consumer reaches these through
 * `Services.studentTransfers.*` (see `@/services`) — never by importing this file
 * directly and never by importing `@schoolhub/api-client` directly.
 *
 * A separate top-level module, not folded into `students-service.ts` — own top-level
 * resource, own three-action state machine, own permission namespace, same shape that
 * earned `guardians` its own module in Phase 2.
 */

/** A single student's transfer history is small and bounded — one bounded page, not
 * `collectPages`, same reasoning as `fetchHouses`. */
export async function fetchStudentTransfers(studentId: string): Promise<StudentTransferRecord[]> {
  const { items } = await fetchPage<StudentTransferRecord>(
    apiClient,
    endpoints.studentTransfers.list,
    { query: { student_id: studentId, page_size: MAX_PAGE_SIZE } },
  );
  return items;
}

/** No `idempotencyKey` parameter — confirmed the server's `perform_create` for transfer
 * requests does not go through `replay_or_execute`, unlike `approveTransfer`/
 * `rejectTransfer`/`completeTransfer` below, which do and each take one. */
export async function requestTransfer(
  studentId: string,
  input: RequestTransferInput,
): Promise<StudentTransferRecord> {
  const body: Record<string, unknown> = {
    student_id: studentId,
    transfer_type: input.transferType,
    from_campus_id: input.fromCampusId,
    reason: input.reason,
    effective_date: input.effectiveDate,
  };
  if (input.transferType === "inter_campus") {
    body.to_campus_id = input.toCampusId;
  } else {
    body.external_school_name = input.externalSchoolName;
  }
  const { data } = await apiClient.post<StudentTransferRecord>(
    endpoints.studentTransfers.create,
    body,
  );
  return data;
}

export async function approveTransfer(
  transferId: string,
  idempotencyKey: string,
): Promise<StudentTransferRecord> {
  const { data } = await apiClient.post<StudentTransferRecord>(
    endpoints.studentTransfers.approve(transferId),
    undefined,
    { idempotencyKey },
  );
  return data;
}

export async function rejectTransfer(
  transferId: string,
  idempotencyKey: string,
): Promise<StudentTransferRecord> {
  const { data } = await apiClient.post<StudentTransferRecord>(
    endpoints.studentTransfers.reject(transferId),
    undefined,
    { idempotencyKey },
  );
  return data;
}

/** `section_id` is omitted entirely, not sent as `null`, when there's no active
 * enrollment to reallocate — `complete_transfer` treats an omitted/absent section as "no
 * enrollment to touch," not an error, for that case. */
export async function completeTransfer(
  transferId: string,
  input: CompleteTransferInput,
  idempotencyKey: string,
): Promise<StudentTransferRecord> {
  const { data } = await apiClient.post<StudentTransferRecord>(
    endpoints.studentTransfers.complete(transferId),
    input.sectionId ? { section_id: input.sectionId } : {},
    { idempotencyKey },
  );
  return data;
}
