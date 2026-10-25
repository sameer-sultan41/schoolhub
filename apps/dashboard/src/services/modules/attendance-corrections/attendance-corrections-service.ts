import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import {
  toCorrectionBody,
  toCorrectionQueryParams,
  toDecisionBody,
} from "./attendance-corrections-helper";
import type {
  AttendanceCorrectionRecord,
  CorrectionAction,
  CorrectionPageQuery,
  RequestCorrectionInput,
} from "./attendance-corrections-type";

/** Attendance corrections' API calls (`/attendance-corrections`), reached through
 * `Services.attendanceCorrections.*`. */

/** Asks for a locked student row to change; it takes effect when an approver agrees. */
export async function requestCorrection(
  input: RequestCorrectionInput,
): Promise<AttendanceCorrectionRecord> {
  const { data } = await apiClient.post<AttendanceCorrectionRecord>(
    endpoints.attendanceCorrections.list,
    toCorrectionBody(input),
  );
  return data;
}

/** One cursor page of corrections: the caller's scope decides which rows they may see. */
export async function fetchCorrectionPage(
  query: CorrectionPageQuery,
): Promise<Page<AttendanceCorrectionRecord>> {
  return fetchPage<AttendanceCorrectionRecord>(apiClient, endpoints.attendanceCorrections.list, {
    query: toCorrectionQueryParams(query),
  });
}

/** `:approve` or `:reject`, each with an optional note; answers with the correction as it now
 * stands. A request already decided is a 409. */
export async function decideCorrection(
  id: string,
  action: CorrectionAction,
  reviewNote?: string,
): Promise<AttendanceCorrectionRecord> {
  const { data } = await apiClient.post<AttendanceCorrectionRecord>(
    endpoints.attendanceCorrections.action(id, action),
    toDecisionBody(reviewNote),
  );
  return data;
}
