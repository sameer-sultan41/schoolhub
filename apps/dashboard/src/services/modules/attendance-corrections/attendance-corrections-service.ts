import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toCorrectionBody } from "./attendance-corrections-helper";
import type {
  AttendanceCorrectionRecord,
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
