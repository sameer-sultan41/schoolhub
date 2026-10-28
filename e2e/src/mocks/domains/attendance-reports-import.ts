import type { ApiErrorDetail, PermissionKey } from "@schoolhub/types";
import { uuid } from "@/data/factories";
import { fail, harnessError, ok, type MockResponse } from "../envelope";
import { compareValues } from "../list";
import type { MockModule } from "../router";
import { PERMISSION_DENIED } from "./attendance-approvals";
import {
  fieldErrors,
  INVALID_DATE,
  INVALID_UUID,
  invalidChoice,
  ISO_DATE,
  isUuid,
  multipartFields,
  REQUIRED,
} from "./attendance-mock-utils";
import { asTime, isTime, refusal } from "./attendance-register";
import {
  type AttendanceRecord,
  lateAfter,
  STUDENT_ATTENDANCE_STATUSES,
  todayUtc,
} from "./attendance-register-store";
import {
  type AttendanceStaffReportsStore,
  DEFAULT_DEFAULTER_THRESHOLD,
  REPORT_MESSAGES,
  type ReportFormat,
  type ReportKind,
  SYNCHRONOUS_REPORT_ROW_LIMIT,
} from "./attendance-staff-reports-store";

const REPORT_KINDS: readonly ReportKind[] = [
  "daily-register",
  "student-summary",
  "defaulters",
  "student-late-arrivals",
  "staff-punctuality",
  "leave",
];
/** The kinds `section_id` narrows; leave and staff punctuality ignore it (`build_report_rows`). */
const SECTIONED_KINDS: readonly ReportKind[] = [
  "daily-register",
  "student-summary",
  "defaulters",
  "student-late-arrivals",
];
const REPORT_FORMATS: readonly ReportFormat[] = ["csv", "xlsx", "pdf"];
/** `AttendanceReportQuerySerializer.threshold`: `max_digits=4, decimal_places=1`, 0 to 100. */
const THRESHOLD_MAX_DIGITS = 4;
const THRESHOLD_DECIMAL_PLACES = 1;
const THRESHOLD_MAX = 100;

/** Where the stub's export files are signed: storage, not the API. `REPORT_EXPORT_GLOB` is the
 * pattern a spec routes to serve them. */
const REPORT_EXPORT_URL_PREFIX = "https://storage.e2e.test/objects/";
export const REPORT_EXPORT_GLOB = `${REPORT_EXPORT_URL_PREFIX}**`;

/** `services.IMPORT_COLUMNS`' required half. */
const REQUIRED_IMPORT_COLUMNS = ["admission_number", "attendance_date", "status"] as const;

/** The report's parameters once `AttendanceReportQuerySerializer` has accepted them. */
interface ReportQuery {
  kind: ReportKind;
  start_date: string;
  end_date: string;
  section_id: string | null;
  period_id: string | null;
  threshold: string | null;
  format: ReportFormat;
}

/** `DecimalField(max_digits=4, decimal_places=1, min_value=0, max_value=100)`, in DRF's order:
 * a number, its digits, then the bounds. */
function thresholdIssue(raw: string): string | null {
  if (!/^-?\d+(\.\d+)?$/.test(raw.trim())) return "A valid number is required.";
  const [whole = "", fraction = ""] = raw.trim().replace(/^-/, "").split(".");
  const wholeDigits = whole.replace(/^0+(?=\d)/, "").length;
  if (wholeDigits + fraction.length > THRESHOLD_MAX_DIGITS) {
    return `Ensure that there are no more than ${THRESHOLD_MAX_DIGITS} digits in total.`;
  }
  if (fraction.length > THRESHOLD_DECIMAL_PLACES) {
    return `Ensure that there are no more than ${THRESHOLD_DECIMAL_PLACES} decimal places.`;
  }
  const value = Number(raw);
  if (value > THRESHOLD_MAX) {
    return `Ensure this value is less than or equal to ${THRESHOLD_MAX}.`;
  }
  if (value < 0) return "Ensure this value is greater than or equal to 0.";
  return null;
}

/** `AttendanceReportQuerySerializer`: every field's error together (400), then the range (422). */
function parseReportQuery(read: (name: string) => string | null): ReportQuery | MockResponse {
  const details: ApiErrorDetail[] = [];
  const kind = read("kind");
  if (!kind) details.push({ field: "kind", issue: REQUIRED });
  else if (!REPORT_KINDS.includes(kind as ReportKind)) {
    details.push({ field: "kind", issue: invalidChoice(kind) });
  }
  const start = read("start_date");
  if (!start) details.push({ field: "start_date", issue: REQUIRED });
  else if (!ISO_DATE.test(start)) details.push({ field: "start_date", issue: INVALID_DATE });
  const end = read("end_date");
  if (end && !ISO_DATE.test(end)) details.push({ field: "end_date", issue: INVALID_DATE });
  for (const field of ["section_id", "period_id"]) {
    const value = read(field);
    if (value && !isUuid(value)) details.push({ field, issue: INVALID_UUID });
  }
  const threshold = read("threshold");
  const issue = threshold ? thresholdIssue(threshold) : null;
  if (issue) details.push({ field: "threshold", issue });
  const format = read("format") ?? "csv";
  if (!REPORT_FORMATS.includes(format as ReportFormat)) {
    details.push({ field: "format", issue: invalidChoice(format) });
  }
  if (details.length > 0) return fieldErrors(details);

  const startDate = start ?? "";
  const endDate = end ?? startDate;
  if (endDate < startDate) return refusal("end_date", REPORT_MESSAGES.rangeBackwards);
  return {
    kind: kind as ReportKind,
    start_date: startDate,
    end_date: endDate,
    section_id: read("section_id"),
    period_id: read("period_id"),
    threshold,
    format: format as ReportFormat,
  };
}

/** A row-level import error, as `import_attendance_row` returns it. */
interface ImportRowError {
  row: string;
  field: string;
  issue: string;
}

/**
 * `GET`/`POST /reports/attendance-summary` and `POST /student-attendance-imports`, for the caller
 * in `store.user`; `attendanceStaffReportsModule` (`./attendance-staff-reports`) registers it
 * with the staff routes, over the same store.
 *
 * Each route checks its permission key first (403), then the serializer (400) and the service's
 * rules in the service's order with its sentences (L5).
 *
 * A report answers with the store's seeded rows for its kind, whatever the range; `defaulters`
 * is the student summary's rows under the threshold (default 75), as the server filters them,
 * and `section_id` narrows the student kinds. Over `SYNCHRONOUS_REPORT_ROW_LIMIT` rows a `GET`
 * queues a job, and a `POST` always does. An export or an import leaves its job (and an
 * export its file) in `store.jobs`/`store.files`: register `jobsModule(store.jobsOptions())`
 * to serve them. The import parses a plain CSV (no quoted fields; its text registered by file
 * name in `importFiles`) and runs `import_attendance_row`'s checks against `store.register`'s
 * rosters, writing locked `import` rows there; its result is `{total, succeeded, failed,
 * errors}`, as `import_attendance_task` reports it.
 */
export function attendanceReportsImportModule(store: AttendanceStaffReportsStore): MockModule {
  const forbidden = (): MockResponse => fail(403, PERMISSION_DENIED);
  const lacks = (key: PermissionKey) => !store.holds(key);

  /** The rows a report of `query.kind` answers with, each carrying `kind`. */
  function reportRows(query: ReportQuery): Record<string, unknown>[] {
    const threshold =
      query.threshold === null ? DEFAULT_DEFAULTER_THRESHOLD : Number(query.threshold);
    const seeds: { section_id?: string | null }[] =
      query.kind === "defaulters"
        ? (store.reportRows["student-summary"] ?? [])
            .filter((row) => row.counted_days > 0 && row.attendance_rate < threshold)
            .sort(
              (a, b) =>
                compareValues(a.last_name, b.last_name) ||
                compareValues(a.first_name, b.first_name) ||
                compareValues(a.student_id, b.student_id),
            )
        : (store.reportRows[query.kind] ?? []);
    const narrows = query.section_id !== null && SECTIONED_KINDS.includes(query.kind);
    return seeds
      .filter((seed) => !narrows || seed.section_id === query.section_id)
      .map(({ section_id: _section, ...row }) => ({ ...row, kind: query.kind }));
  }

  /** `_queue_export`: a job that rebuilds the same rows into a file of `format`. */
  function queueExport(query: ReportQuery, message: string): MockResponse {
    const jobId = uuid();
    const fileId = uuid();
    const rows = reportRows(query).length;
    store.files.push({
      id: fileId,
      downloadUrl: `${REPORT_EXPORT_URL_PREFIX}${fileId}-attendance-report.bin`,
    });
    store.jobs[jobId] = [
      { status: "running", progress: 50 },
      {
        status: "succeeded",
        progress: 100,
        result: {
          result_file_id: fileId,
          rows,
          format: query.format,
          attendance_mode: store.attendanceMode,
        },
      },
    ];
    store.exports.push({
      jobId,
      format: query.format,
      rows,
      query: {
        kind: query.kind,
        start_date: query.start_date,
        end_date: query.end_date,
        section_id: query.section_id,
        period_id: query.period_id,
        threshold: query.threshold,
      },
    });
    return ok({ job_id: jobId, status: "queued" }, { status: 202, meta: { message } });
  }

  /** `import_attendance_row`, in its order, writing the row into the register store. */
  function importRow(
    row: Record<string, string>,
    rowNumber: number,
    sessionId: string,
  ): ImportRowError | null {
    const register = store.register;
    const at = (field: string, issue: string) => ({ row: String(rowNumber), field, issue });
    const missing = REQUIRED_IMPORT_COLUMNS.find((column) => !row[column]);
    if (missing) return at(missing, "This column is required.");
    const status = (row["status"] ?? "").trim().toLowerCase();
    if (!STUDENT_ATTENDANCE_STATUSES.includes(status as AttendanceRecord["status"])) {
      const raw = row["status"] ?? "";
      return at("status", `'${raw}' is not one of: ${STUDENT_ATTENDANCE_STATUSES.join(", ")}.`);
    }
    if (status === "on_leave") {
      return at(
        "status",
        "'on_leave' needs a leave request; import a migrated leave day as 'excused'.",
      );
    }
    const date = (row["attendance_date"] ?? "").trim();
    if (!ISO_DATE.test(date) || Number.isNaN(Date.parse(date))) {
      const raw = row["attendance_date"] ?? "";
      return at("attendance_date", `'${raw}' is not an ISO date (YYYY-MM-DD).`);
    }
    if (date > todayUtc()) {
      return at("attendance_date", "A historical import cannot carry a future date.");
    }
    const times: Record<string, string | null> = {};
    for (const field of ["check_in_time", "check_out_time"]) {
      const value = (row[field] ?? "").trim();
      if (value && !isTime(value)) {
        return at(field, `'${value}' is not a time (HH:MM or HH:MM:SS).`);
      }
      times[field] = asTime(value);
    }
    const admission = (row["admission_number"] ?? "").trim();
    const section = register?.sections.find((candidate) =>
      candidate.students.some((student) => student.admissionNumber === admission),
    );
    const student = section?.students.find((s) => s.admissionNumber === admission);
    if (!register || !section || !student) {
      return at("admission_number", "No live student has this admission number.");
    }
    if (register.session.id !== sessionId) {
      return at("admission_number", "This student has no enrollment in the named session.");
    }
    const existing = register.find(student.id, date, null);
    if (existing?.status === "on_leave") {
      return at(
        "attendance_date",
        "This student has approved leave on this date; cancel it before importing.",
      );
    }
    if (existing && existing.source !== "import" && register.isLocked(existing)) {
      return at(
        "attendance_date",
        "A locked record already exists for this date; change it through a correction " +
          "request rather than a re-import.",
      );
    }
    const checkIn = times["check_in_time"] ?? null;
    const values: Partial<AttendanceRecord> = {
      status: status as AttendanceRecord["status"],
      check_in_time: checkIn,
      check_out_time: times["check_out_time"] ?? null,
      late_minutes:
        status === "late" && checkIn
          ? lateAfter(register.dayStart, checkIn, register.graceMinutes)
          : null,
      remarks: row["remarks"] || null,
      source: "import",
      is_locked: true,
    };
    if (existing) Object.assign(existing, values);
    else register.records.push(register.recordFor(section, student, date, values));
    return null;
  }

  return (api) => {
    api.get("/reports/attendance-summary", (request) => {
      if (lacks("attendance.report.view")) return forbidden();
      const query = parseReportQuery((name) => request.searchParams.get(name));
      if (!("kind" in query)) return query;
      const rows = reportRows(query);
      if (rows.length > SYNCHRONOUS_REPORT_ROW_LIMIT) {
        // The file a `GET` queues is the serializer's default format.
        return queueExport({ ...query, format: "csv" }, REPORT_MESSAGES.queuedInline);
      }
      return ok(rows, {
        meta: { kind: query.kind, row_count: rows.length, attendance_mode: store.attendanceMode },
      });
    });

    api.post("/reports/attendance-summary", (request) => {
      if (lacks("attendance.report.export")) return forbidden();
      const body = (request.json() as Record<string, unknown> | null) ?? {};
      const query = parseReportQuery((name) => {
        const value = body[name];
        if (value === undefined || value === null) return null;
        if (typeof value === "string") return value;
        return typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : JSON.stringify(value);
      });
      if (!("kind" in query)) return query;
      return queueExport(query, REPORT_MESSAGES.queuedExport);
    });

    api.post("/student-attendance-imports", (request) => {
      if (lacks("attendance.student-attendance.import")) return forbidden();
      // Not a 400: an unreadable body is the harness's failure, not the request's.
      if (request.text() === null) return harnessError("The import's multipart body was empty");
      const fields = multipartFields(request);
      const file = fields["file"];
      const sessionId = fields["academic_session_id"]?.value ?? "";
      const details: ApiErrorDetail[] = [];
      if (!file || file.filename === null) {
        details.push({ field: "file", issue: "No file was submitted." });
      }
      if (!sessionId) details.push({ field: "academic_session_id", issue: REQUIRED });
      if (details.length > 0 || !file) return fieldErrors(details);

      const jobId = uuid();
      // A blob-backed part can reach interception without its bytes, so the spec registers the
      // file's text under its name (`importFiles`); the multipart's own text is the fallback.
      const text = store.importFiles[file.filename ?? ""] ?? file.value;
      // The worker: parse the header once (a missing column fails the job), then each row.
      const lines = text.split(/\r?\n/);
      const header = (lines[0] ?? "").split(",").map((name) => name.trim());
      const missing = REQUIRED_IMPORT_COLUMNS.filter((column) => !header.includes(column));
      if (text.trim() === "" || missing.length > 0) {
        const error =
          text.trim() === ""
            ? "The file is empty — it needs a header row."
            : `Missing required column(s): ${missing.join(", ")}. ` +
              "Header names must match the template exactly.";
        store.jobs[jobId] = [{ status: "failed", progress: 0, error }];
      } else {
        const errors: ImportRowError[] = [];
        let rows = 0;
        let succeeded = 0;
        lines.slice(1).forEach((line, index) => {
          // `csv.DictReader` skips a blank line, but its line number still counts it.
          if (line.trim() === "") return;
          rows += 1;
          const cells = line.split(",");
          const row = Object.fromEntries(header.map((name, at) => [name, cells[at] ?? ""]));
          const error = importRow(row, index + 2, sessionId);
          if (error) errors.push(error);
          else succeeded += 1;
        });
        store.jobs[jobId] = [
          { status: "running", progress: 0 },
          {
            status: "succeeded",
            progress: 100,
            result: { total: rows, succeeded, failed: errors.length, errors },
          },
        ];
      }
      return ok(
        { job_id: jobId, status: "queued" },
        { status: 202, meta: { message: REPORT_MESSAGES.importQueued } },
      );
    });
  };
}
