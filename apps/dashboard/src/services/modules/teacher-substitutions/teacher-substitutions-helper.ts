import type { AuthenticatedUser } from "@schoolhub/types";

import { FILTER_ALL } from "@/lib/constants";
import { copyMappedFields } from "@/lib/helpers";
import { hasPermission } from "@/lib/permissions";
import {
  OPEN_SUBSTITUTION_STATUSES,
  SUBSTITUTION_BODY_FIELDS,
  SUBSTITUTION_QUERY_FIELDS,
} from "./teacher-substitutions-constant";
import type { ProposeFormValues } from "./teacher-substitutions.schema";
import type {
  ProposeSubstitutionInput,
  SubstitutionPageQuery,
  SubstitutionStatus,
  TeacherSubstitutionRecord,
} from "./teacher-substitutions-type";

/** The cover queue's pure helpers. */

export function toSubstitutionBody(input: ProposeSubstitutionInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  // Every field is always sent: a blank room or reason is an explicit `null`.
  copyMappedFields(input, SUBSTITUTION_BODY_FIELDS, () => true, body);
  return body;
}

export function toSubstitutionQueryParams(
  query: SubstitutionPageQuery,
): Record<string, string | number | boolean | undefined> {
  const params: Record<string, unknown> = { page: query.page, page_size: query.pageSize };
  copyMappedFields(
    query,
    SUBSTITUTION_QUERY_FIELDS,
    (value) => value !== undefined && value !== "",
    params,
  );
  return params as Record<string, string | number | boolean | undefined>;
}

/** The status filter -> `status`: `all` is no filter. */
export function statusFilterToStatus(value: string): SubstitutionStatus | undefined {
  return value === FILTER_ALL ? undefined : (value as SubstitutionStatus);
}

/** The propose form -> the service input; a blank room or reason is `null`. */
export function buildProposeInput(values: ProposeFormValues): ProposeSubstitutionInput {
  const reason = values.reason.trim();
  return {
    timetableSlotId: values.timetable_slot_id,
    date: values.date,
    absentStaffId: values.absent_staff_id,
    substituteStaffId: values.substitute_staff_id,
    roomId: values.room_id || null,
    reason: reason === "" ? null : reason,
  };
}

/** `YYYY-MM-DD` -> the API's Monday-based `day_of_week` (0 Monday ... 6 Sunday). Parsed as
 * a calendar date, never through the viewer's timezone. */
export function weekdayOfIsoDate(isoDate: string): number {
  const [year = 0, month = 1, day = 1] = isoDate.split("-").map(Number);
  const sundayBased = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return (sundayBased + 6) % 7;
}

/** Whether `user` may cancel this cover: an approver any open cover, a proposer only their
 * own proposal; never past cover. Mirrors `:cancel`'s own check, which is what enforces. */
export function canCancelSubstitution(
  record: TeacherSubstitutionRecord,
  user: AuthenticatedUser | undefined,
  today: string,
): boolean {
  if (!user || record.date < today) return false;
  if (!OPEN_SUBSTITUTION_STATUSES.includes(record.status)) return false;
  if (hasPermission(user, "timetable.substitution.approve")) return true;
  return (
    record.status === "proposed" &&
    record.created_by === user.id &&
    hasPermission(user, "timetable.substitution.create")
  );
}
