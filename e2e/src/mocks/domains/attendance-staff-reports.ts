import type { ApiErrorDetail, PermissionKey } from "@schoolhub/types";
import { fail, harnessError, ok, type MockResponse } from "../envelope";
import { compareValues, cursorPageOf } from "../list";
import type { MockModule } from "../router";
import { PERMISSION_DENIED } from "./attendance-approvals";
import {
  colonAction,
  fieldErrors,
  INVALID_DATE,
  INVALID_UUID,
  invalidChoice,
  ISO_DATE,
  isUuid,
  REQUIRED,
} from "./attendance-mock-utils";
import {
  asTime,
  type CorrectionBody,
  type CorrectionTarget,
  dateIssue,
  dateRefusal,
  isTime,
  raiseCorrection,
  refusal,
  studentCorrectionTarget,
  TIME_FORMAT_ISSUE,
} from "./attendance-register";
import { STAFF_ATTENDANCE_STATUSES, type StaffAttendanceStatus } from "./attendance-register-store";
import { attendanceReportsImportModule } from "./attendance-reports-import";
import {
  type AttendanceStaffReportsStore,
  STAFF_ATTENDANCE_MESSAGES,
  type StaffAttendanceRecord,
  staffName,
} from "./attendance-staff-reports-store";

const invalidPk = (value: string) => `Invalid pk "${value}" - object does not exist.`;

interface StaffMarkBody {
  staff_id?: string;
  attendance_date?: string;
  status?: string;
  check_in_time?: string | null;
  check_out_time?: string | null;
  remarks?: string | null;
}

/**
 * `/staff-attendance` (the register, the cursor list, marking and `:check-out`) and
 * `POST /attendance-corrections` for both targets, for the caller in `store.user`, together with
 * the reports and the historical import (`attendanceReportsImportModule`,
 * `./attendance-reports-import`) over the same store.
 *
 * Each route checks its permission key first (403), then the record scope (404 under `own`),
 * then the serializer (400) and the service's rules in the service's order with its sentences
 * (L5). Lists are cursor paged: a cursor the stub did not issue is a 404 "Invalid cursor".
 *
 * `POST /attendance-corrections` is also `attendanceRegisterModule`'s: the router has no
 * fallthrough, and the module registered last wins, so register this one after it. A student
 * target still resolves, through `store.register`.
 */
export function attendanceStaffReportsModule(store: AttendanceStaffReportsStore): MockModule {
  const forbidden = (): MockResponse => fail(403, PERMISSION_DENIED);
  const lacks = (key: PermissionKey) => !store.holds(key);
  const visibleIds = () => new Set(store.visibleStaff().map((member) => member.id));

  function staffCorrectionTarget(id: string): CorrectionTarget | undefined {
    const row = store.records.find((candidate) => candidate.id === id);
    if (!row || !visibleIds().has(row.staff_id)) return undefined;
    return {
      field: "staff_attendance_id",
      locked: store.isLocked(row),
      current: {
        status: row.status,
        check_in_time: row.check_in_time ?? null,
        check_out_time: row.check_out_time ?? null,
      },
      subject: {
        subject_type: "staff",
        student_attendance_id: null,
        staff_attendance_id: row.id,
        student_id: null,
        student_name: null,
        staff_name: row.staff_name,
        employee_number: row.employee_number,
        subject_user_id: store.staff.find((member) => member.id === row.staff_id)?.userId ?? null,
        attendance_date: row.attendance_date,
        period_name: null,
      },
    };
  }

  return (api) => {
    api.get("/staff-attendance/register", (request) => {
      if (lacks("attendance.staff-attendance.mark")) return forbidden();
      const date = request.searchParams.get("date");
      if (!date) return fieldErrors([{ field: "date", issue: REQUIRED }]);
      if (!ISO_DATE.test(date)) return fieldErrors([{ field: "date", issue: INVALID_DATE }]);
      const departmentId = request.searchParams.get("department_id");
      if (departmentId && !isUuid(departmentId)) {
        return fieldErrors([{ field: "department_id", issue: INVALID_UUID }]);
      }
      if (departmentId && !store.staff.some((member) => member.department?.id === departmentId)) {
        return fail(404, "Not found.");
      }

      const entries = store
        .visibleStaff()
        .filter(
          (member) =>
            member.active &&
            member.joiningDate <= date &&
            (!departmentId || member.department?.id === departmentId),
        )
        .sort(
          (a, b) =>
            compareValues(a.lastName, b.lastName) ||
            compareValues(a.firstName, b.firstName) ||
            compareValues(a.id, b.id),
        )
        .map((member) => {
          const record = store.find(member.id, date);
          return {
            staff_id: member.id,
            staff_name: staffName(member),
            employee_number: member.employeeNumber,
            department_name: member.department?.name ?? null,
            record: record ? store.serialize(record) : null,
            on_leave: store.leave.has(`${member.id}:${date}`) || record?.status === "on_leave",
          };
        });
      return ok(entries, { meta: { date } });
    });

    api.get("/staff-attendance", (request) => {
      if (lacks("attendance.staff-attendance.view")) return forbidden();
      const params = request.searchParams;
      const reach = visibleIds();
      const from = params.get("date__gte");
      const to = params.get("date__lte");
      const exact: [string, (row: StaffAttendanceRecord) => string | undefined][] = [
        ["staff_id", (row) => row.staff_id],
        ["date", (row) => row.attendance_date],
        ["status", (row) => row.status],
        ["source", (row) => row.source],
      ];
      const rows = store.records
        .filter(
          (row) =>
            reach.has(row.staff_id) &&
            exact.every(([name, value]) => !params.get(name) || value(row) === params.get(name)) &&
            (!from || row.attendance_date >= from) &&
            (!to || row.attendance_date <= to),
        )
        .map((row) => store.serialize(row));
      const ordering = params.get("ordering") || "-created_at";
      const field = ordering.replace(/^-/, "") as keyof StaffAttendanceRecord;
      const direction = ordering.startsWith("-") ? -1 : 1;
      rows.sort((a, b) => direction * compareValues(a[field], b[field]));
      return cursorPageOf(rows, params);
    });

    api.post("/staff-attendance", (request) => {
      if (lacks("attendance.staff-attendance.mark")) return forbidden();
      const body = (request.json() as StaffMarkBody | null) ?? {};
      const details: ApiErrorDetail[] = [];
      const member = body.staff_id ? store.member(body.staff_id) : undefined;
      if (!body.staff_id) details.push({ field: "staff_id", issue: REQUIRED });
      else if (!member) details.push({ field: "staff_id", issue: invalidPk(body.staff_id) });
      if (!body.attendance_date) details.push({ field: "attendance_date", issue: REQUIRED });
      else if (!ISO_DATE.test(body.attendance_date)) {
        details.push({ field: "attendance_date", issue: INVALID_DATE });
      }
      if (!body.status) details.push({ field: "status", issue: REQUIRED });
      else if (!STAFF_ATTENDANCE_STATUSES.includes(body.status as StaffAttendanceStatus)) {
        details.push({ field: "status", issue: invalidChoice(body.status) });
      }
      for (const field of ["check_in_time", "check_out_time"] as const) {
        const value = body[field];
        if (value && !isTime(value)) details.push({ field, issue: TIME_FORMAT_ISSUE });
      }
      if (details.length > 0 || !member) return fieldErrors(details);
      const date = body.attendance_date ?? "";
      const status = body.status as StaffAttendanceStatus;
      const checkIn = asTime(body.check_in_time);
      const checkOut = asTime(body.check_out_time);
      if (checkIn && checkOut && checkOut <= checkIn) {
        return fieldErrors([
          { field: "check_out_time", issue: STAFF_ATTENDANCE_MESSAGES.checkOutNotAfterBody },
        ]);
      }

      // `mark_staff_attendance`: the date, then `on_leave`, then a locked row, then the upsert.
      const issue = dateIssue(store, date);
      if (issue) return dateRefusal(date, issue);
      if (status === "on_leave") return refusal("status", STAFF_ATTENDANCE_MESSAGES.systemOnly);
      const existing = store.find(member.id, date);
      if (existing && store.isLocked(existing)) {
        return fail(409, STAFF_ATTENDANCE_MESSAGES.locked);
      }
      const values: Partial<StaffAttendanceRecord> = {
        status,
        check_in_time: checkIn,
        check_out_time: checkOut,
        ...store.minutes(status, checkIn, checkOut),
        remarks: body.remarks ?? null,
        // `self` when the caller is the staff member: derived, never sent (§5.2).
        source: member.userId === store.user.id ? "self" : "manual",
        marked_by: store.user.id,
        updated_at: new Date().toISOString(),
      };
      const row = existing ?? store.recordFor(member, date, values);
      if (existing) Object.assign(existing, values);
      else store.records.push(row);
      // The view answers 201 for the upsert's update as well as for a new row.
      return ok(store.serialize(row), { status: 201 });
    });

    api.post("/staff-attendance/:staffAction", (request) => {
      const { id, action } = colonAction(request.params["staffAction"]);
      if (action !== "check-out") return harnessError(`No mock for staff :${action ?? ""}`);
      if (lacks("attendance.staff-attendance.mark")) return forbidden();
      const row = store.records.find((candidate) => candidate.id === id);
      if (!row || !visibleIds().has(row.staff_id)) return fail(404, "Not found.");
      const body = (request.json() as { check_out_time?: string } | null) ?? {};
      if (!body.check_out_time) return fieldErrors([{ field: "check_out_time", issue: REQUIRED }]);
      if (!isTime(body.check_out_time)) {
        return fieldErrors([{ field: "check_out_time", issue: TIME_FORMAT_ISSUE }]);
      }
      const checkOut = asTime(body.check_out_time) ?? "";

      // `check_out_staff`: a check-in, a later time, then the lock.
      if (!row.check_in_time) {
        return refusal("check_out_time", STAFF_ATTENDANCE_MESSAGES.noCheckIn);
      }
      if (checkOut <= row.check_in_time) {
        return refusal("check_out_time", STAFF_ATTENDANCE_MESSAGES.checkOutNotAfter);
      }
      if (store.isLocked(row)) return fail(409, STAFF_ATTENDANCE_MESSAGES.checkOutLocked);
      row.check_out_time = checkOut;
      const { early_departure_minutes: early } = store.minutes(row.status, null, checkOut);
      row.early_departure_minutes = early;
      row.updated_at = new Date().toISOString();
      return ok(store.serialize(row), { meta: { message: STAFF_ATTENDANCE_MESSAGES.checkedOut } });
    });

    api.post("/attendance-corrections", (request) => {
      if (lacks("attendance.correction.create")) return forbidden();
      const register = store.register;
      return raiseCorrection(
        (request.json() as CorrectionBody | null) ?? {},
        (field, id) =>
          field === "staff_attendance_id"
            ? staffCorrectionTarget(id)
            : register && studentCorrectionTarget(register, id),
        { id: store.user.id, name: store.user.full_name },
        (correction) => store.corrections.push(correction),
      );
    });

    attendanceReportsImportModule(store)(api);
  };
}
