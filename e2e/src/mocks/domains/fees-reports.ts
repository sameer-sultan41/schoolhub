import type { ApiSchemas } from "@schoolhub/api-client";
import type { PermissionKey } from "@schoolhub/types";
import { uuid } from "@/data/factories";
import { fail, ok, type MockResponse } from "../envelope";
import type { MockModule } from "../router";
import type { FileDownloadStub, JobStub, JobsOptions } from "./jobs";
import { REPORT_EXPORT_GLOB } from "./attendance-reports-import";

/**
 * `GET/POST /reports/finance-summary` (`FinanceReportView`), with the typed rows the server's row
 * serializers send (`report_serializers.py`): money as two-decimal strings, the discriminator in
 * `kind`, a collection row carrying all three grouping keys (null for the two it was not grouped
 * by), a statement line's and a grant's own type under `entry_type` and `grant_type`.
 *
 * It enforces what the server enforces and the screen surfaces (L5), in its words: an unknown
 * kind, group or format is a 400 under its field, a missing or malformed date is a 400, a range
 * that ends before it starts is a 400 under `date_to`, a statement without a student is a 400
 * under `student`, a campus, session or class filter on a kind that has no such dimension is a
 * 400 under that filter, and a report over the inline ceiling is a 422 carrying
 * `meta.row_limit` (the stub's `rowLimit` stands in for the server's 1000, so a spec need not
 * seed a thousand rows). `fees.report.view` reads and `fees.report.export` exports; without the
 * key it is a 403. A POST answers `202` + a job; the spec wires `jobsOptions()` into `jobsModule`
 * and the job succeeds with a file after one poll.
 *
 * What it does not do: filter income, trial-balance and budget rows by date, or compute the
 * aging buckets. The rows a spec seeds are the rows returned. Whether the server really narrows
 * and sums as the screen assumes is the live lane's (`tests/live/api/fees-reports.spec.ts`).
 */

export type FinanceReportRow = ApiSchemas["FinanceReportRow"];
export type FinanceReportKind = ApiSchemas["FinanceReportQueryKindEnum"];
type ReportFormat = ApiSchemas["FormatEnum"];
type GroupBy = ApiSchemas["GroupByEnum"];

/** The server's own ceiling (`services.SYNCHRONOUS_REPORT_ROW_LIMIT`). */
export const FINANCE_REPORT_ROW_LIMIT = 1000;

/** The sentences the server sends. */
const MESSAGES = {
  required: "This field is required.",
  invalidUuid: "Must be a valid UUID.",
  invalidDate: "Date has wrong format. Use one of these formats instead: YYYY-MM-DD.",
  reversed: "The end of the period cannot precede its start.",
  needsStudent: "A student ledger needs the student it is for.",
  notFilterable: "This report cannot be filtered this way.",
  tooLarge:
    "This report is too large to return inline. POST the same parameters to receive it as an export job.",
  denied: "You do not have permission to perform this action.",
  queued: "Report export queued.",
} as const;

const KINDS: readonly FinanceReportKind[] = [
  "collection",
  "outstanding-aging",
  "student-ledger",
  "grant-register",
  "income-vs-expense",
  "budget-variance",
  "expense-register",
  "trial-balance",
];
const GROUPINGS: readonly GroupBy[] = ["day", "method", "cashier"];
const FORMATS: readonly ReportFormat[] = ["csv", "xlsx", "pdf"];

type Filter = "campus_id" | "academic_session_id" | "class_id";
const FILTERS: readonly Filter[] = ["campus_id", "academic_session_id", "class_id"];
const STUDENT_FILTERS: readonly Filter[] = FILTERS;
/** `reports.REPORT_FILTERS_BY_KIND`. */
const FILTERS_BY_KIND: Record<FinanceReportKind, readonly Filter[]> = {
  collection: STUDENT_FILTERS,
  "outstanding-aging": STUDENT_FILTERS,
  "student-ledger": STUDENT_FILTERS,
  "grant-register": STUDENT_FILTERS,
  "income-vs-expense": [],
  "budget-variance": [],
  "expense-register": ["campus_id"],
  "trial-balance": [],
};

/** A seeded row and the dimensions the server narrows it by. */
export interface ReportSeedRow {
  row: FinanceReportRow;
  student_id?: string;
  campus_id?: string;
  academic_session_id?: string;
  class_id?: string;
}

/** One confirmed payment: the collection report groups these as the server does. */
export interface CollectionSeed {
  /** `YYYY-MM-DD` (the report's `paid_at` date). */
  day: string;
  method: ApiSchemas["PaymentMethodEnum"];
  received_by: string | null;
  amount: string;
  campus_id?: string;
  academic_session_id?: string;
  class_id?: string;
}

export interface FinanceReportsOptions {
  /** The keys the caller holds: `fees.report.view` reads, `fees.report.export` exports. */
  permissions: readonly PermissionKey[];
  payments?: CollectionSeed[];
  /** Every other kind's rows, as the server sends them. */
  rows?: Partial<Record<Exclude<FinanceReportKind, "collection">, ReportSeedRow[]>>;
  /** The inline ceiling: the server's 1000, or a small number so a spec need not seed that many. */
  rowLimit?: number;
}

export interface ExportRequest {
  kind: FinanceReportKind;
  format: ReportFormat;
  body: Record<string, unknown>;
  rows: number;
}

const cents = (value: string) => Math.round(Number(value) * 100);
const decimal = (value: number) => (value / 100).toFixed(2);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid(field: string, issue: string): MockResponse {
  return fail(400, issue, { details: [{ field, issue }] });
}

function badChoice(field: string, value: string): MockResponse {
  return invalid(field, `"${value}" is not a valid choice.`);
}

interface Query {
  kind: FinanceReportKind;
  date_from: string;
  date_to: string;
  student: string | null;
  group_by: GroupBy;
  format: ReportFormat;
  filters: Partial<Record<Filter, string>>;
}

/** `FinanceReportQuerySerializer`, in field order, answering the first refusal. */
function parseQuery(source: Record<string, unknown>): Query | MockResponse {
  const text = (key: string) => {
    const value = source[key];
    return typeof value === "string" && value !== "" ? value : null;
  };
  const kind = text("kind");
  if (kind === null) return invalid("kind", MESSAGES.required);
  if (!KINDS.includes(kind as FinanceReportKind)) return badChoice("kind", kind);

  const dates: Record<"date_from" | "date_to", string> = { date_from: "", date_to: "" };
  for (const key of ["date_from", "date_to"] as const) {
    const value = text(key);
    if (value === null) return invalid(key, MESSAGES.required);
    if (!ISO_DATE.test(value)) return invalid(key, MESSAGES.invalidDate);
    dates[key] = value;
  }

  const student = text("student");
  if (student !== null && !UUID.test(student)) return invalid("student", MESSAGES.invalidUuid);
  const filters: Partial<Record<Filter, string>> = {};
  for (const key of FILTERS) {
    const value = text(key);
    if (value === null) continue;
    if (!UUID.test(value)) return invalid(key, MESSAGES.invalidUuid);
    filters[key] = value;
  }
  const groupBy = text("group_by") ?? "day";
  if (!GROUPINGS.includes(groupBy as GroupBy)) return badChoice("group_by", groupBy);
  const format = text("format") ?? "csv";
  if (!FORMATS.includes(format as ReportFormat)) return badChoice("format", format);

  if (dates.date_to < dates.date_from) return invalid("date_to", MESSAGES.reversed);
  if (kind === "student-ledger" && student === null) {
    return invalid("student", MESSAGES.needsStudent);
  }
  const allowed = FILTERS_BY_KIND[kind as FinanceReportKind];
  const refused = FILTERS.find((key) => filters[key] !== undefined && !allowed.includes(key));
  if (refused) return invalid(refused, MESSAGES.notFilterable);

  return {
    kind: kind as FinanceReportKind,
    ...dates,
    student,
    group_by: groupBy as GroupBy,
    format: format as ReportFormat,
    filters,
  };
}

/** The collection report's rows: confirmed payments in the window, summed per group as the
 * server's `GROUP BY` does (day ascending, the others by total descending). */
function collectionRows(payments: CollectionSeed[], query: Query): FinanceReportRow[] {
  const inScope = payments.filter(
    (payment) =>
      payment.day >= query.date_from &&
      payment.day <= query.date_to &&
      FILTERS.every(
        (key) => query.filters[key] === undefined || payment[key] === query.filters[key],
      ),
  );
  const groups = new Map<string, { total: number; count: number; sample: CollectionSeed }>();
  for (const payment of inScope) {
    const key =
      query.group_by === "day"
        ? payment.day
        : query.group_by === "method"
          ? payment.method
          : (payment.received_by ?? "");
    const group = groups.get(key) ?? { total: 0, count: 0, sample: payment };
    group.total += cents(payment.amount);
    group.count += 1;
    groups.set(key, group);
  }
  const rows = [...groups.values()].map(({ total, count, sample }) => ({
    kind: "collection" as const,
    day: query.group_by === "day" ? sample.day : null,
    method: query.group_by === "method" ? sample.method : null,
    received_by: query.group_by === "cashier" ? sample.received_by : null,
    total: decimal(total),
    count,
  }));
  return query.group_by === "day"
    ? rows.sort((a, b) => (a.day ?? "").localeCompare(b.day ?? ""))
    : rows.sort((a, b) => cents(b.total) - cents(a.total));
}

function otherRows(seed: ReportSeedRow[], query: Query): FinanceReportRow[] {
  return seed
    .filter(
      (entry) =>
        (query.kind !== "student-ledger" || entry.student_id === query.student) &&
        FILTERS.every(
          (key) => query.filters[key] === undefined || entry[key] === query.filters[key],
        ),
    )
    .map((entry) => entry.row);
}

/**
 * Held by reference: a spec reads what the server did. `exports` records each POST, `jobs` and
 * `files` go to `jobsModule` through `jobsOptions()`.
 */
export class FinanceReportsState {
  readonly exports: ExportRequest[] = [];
  readonly jobs: Record<string, JobStub[]> = {};
  readonly files: FileDownloadStub[] = [];
  /** Every GET's parsed parameters, in order. */
  readonly runs: Record<string, string>[] = [];

  constructor(readonly options: FinanceReportsOptions) {}

  jobsOptions(): JobsOptions {
    return { jobs: this.jobs, files: this.files };
  }

  holds(key: PermissionKey): boolean {
    return this.options.permissions.includes(key);
  }

  rowsFor(query: Query): FinanceReportRow[] {
    return query.kind === "collection"
      ? collectionRows(this.options.payments ?? [], query)
      : otherRows(this.options.rows?.[query.kind] ?? [], query);
  }
}

export function feesReportsModule(state: FinanceReportsState): MockModule {
  return (api) => {
    api.get("/reports/finance-summary", (request) => {
      if (!state.holds("fees.report.view")) return fail(403, MESSAGES.denied);
      const query = parseQuery(Object.fromEntries(request.searchParams));
      if ("status" in query) return query;
      state.runs.push(Object.fromEntries(request.searchParams));

      const rows = state.rowsFor(query);
      const limit = state.options.rowLimit ?? FINANCE_REPORT_ROW_LIMIT;
      if (rows.length > limit) {
        return fail(422, MESSAGES.tooLarge, {
          code: "domain_rule_violation",
          details: [{ field: "non_field", issue: MESSAGES.tooLarge }],
          meta: { row_limit: limit },
        });
      }
      return ok(rows, {
        meta: {
          kind: query.kind,
          row_count: rows.length,
          date_from: query.date_from,
          date_to: query.date_to,
        },
      });
    });

    api.post("/reports/finance-summary", (request) => {
      if (!state.holds("fees.report.export")) return fail(403, MESSAGES.denied);
      const body = (request.json() as Record<string, unknown> | null) ?? {};
      const query = parseQuery(body);
      if ("status" in query) return query;

      const rows = state.rowsFor(query);
      const jobId = uuid();
      const fileId = uuid();
      state.jobs[jobId] = [
        { status: "queued", progress: 0 },
        {
          status: "succeeded",
          progress: 100,
          result: { result_file_id: fileId, rows: rows.length, format: query.format },
        },
      ];
      state.files.push({
        id: fileId,
        downloadUrl: `${REPORT_EXPORT_GLOB.slice(0, -2)}${fileId}.${query.format}`,
      });
      state.exports.push({ kind: query.kind, format: query.format, body, rows: rows.length });
      return ok(
        { job_id: jobId, status: "queued" },
        { status: 202, meta: { message: MESSAGES.queued } },
      );
    });
  };
}
