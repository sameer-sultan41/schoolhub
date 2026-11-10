import { isIsoDate, isUuid } from "@/lib/helpers";
import type {
  FinanceReportGroupBy,
  FinanceReportKind,
  FinanceReportKindFields,
  FinanceReportQuery,
} from "./finance-reports-type";

/** The finance-reports module's constants. */

/** The query-key module a report run lives under, and the job watches its exports use. */
export const FINANCE_REPORTS_QUERY_MODULE = "finance-reports";
export const FINANCE_REPORT_RESOURCE = "report";

/** Which inputs each kind takes, keyed so the compiler checks it against the generated enum (L32). */
export const FINANCE_REPORT_KIND_FIELDS: Record<FinanceReportKind, FinanceReportKindFields> = {
  collection: {
    dates: "range",
    student: false,
    groupBy: true,
    campus: true,
    session: true,
    class: true,
  },
  "outstanding-aging": {
    dates: "asOf",
    student: false,
    groupBy: false,
    campus: true,
    session: true,
    class: true,
  },
  "student-ledger": {
    dates: "none",
    student: true,
    groupBy: false,
    campus: false,
    session: true,
    class: false,
  },
  "grant-register": {
    dates: "none",
    student: false,
    groupBy: false,
    campus: true,
    session: true,
    class: true,
  },
  "income-vs-expense": {
    dates: "range",
    student: false,
    groupBy: false,
    campus: false,
    session: false,
    class: false,
  },
  "budget-variance": {
    dates: "asOf",
    student: false,
    groupBy: false,
    campus: false,
    session: false,
    class: false,
  },
  "expense-register": {
    dates: "range",
    student: false,
    groupBy: false,
    campus: true,
    session: false,
    class: false,
  },
  "trial-balance": {
    dates: "range",
    student: false,
    groupBy: false,
    campus: false,
    session: false,
    class: false,
  },
};

/** The kinds in the picker's order (`reports.REPORT_KINDS`). */
export const FINANCE_REPORT_KINDS = Object.keys(FINANCE_REPORT_KIND_FIELDS) as FinanceReportKind[];

/** §8's collection dashboard: the screen opens on today's collection. */
export const DEFAULT_FINANCE_REPORT_KIND: FinanceReportKind = "collection";

/** How `collection` groups its rows, keyed so the compiler checks it against the generated enum. */
const GROUP_BY_SET: Record<FinanceReportGroupBy, true> = { day: true, method: true, cashier: true };
export const FINANCE_REPORT_GROUPINGS = Object.keys(GROUP_BY_SET) as FinanceReportGroupBy[];
export const DEFAULT_FINANCE_REPORT_GROUPING: FinanceReportGroupBy = "day";

/** A range report other than the collection opens on this many calendar days, today included. */
export const FINANCE_REPORT_DEFAULT_RANGE_DAYS = 30;

/** The report form's URL keys. */
export const FINANCE_REPORT_URL_KEYS = {
  kind: "kind",
  from: "from",
  to: "to",
  student: "student",
  group: "group",
  campus: "campus",
  session: "session",
  class: "class",
} as const;

const isDateOrEmpty = (value: string) => value === "" || isIsoDate(value);
const isUuidOrEmpty = (value: string) => value === "" || isUuid(value);

/**
 * The report form's URL filters (`useDataGridUrlState`). A blank date is the default (today, or
 * the last `FINANCE_REPORT_DEFAULT_RANGE_DAYS` days); a blank id is no filter.
 */
export const FINANCE_REPORT_URL_FILTERS = {
  [FINANCE_REPORT_URL_KEYS.kind]: {
    default: DEFAULT_FINANCE_REPORT_KIND,
    isValid: (value: string) => Object.hasOwn(FINANCE_REPORT_KIND_FIELDS, value),
  },
  [FINANCE_REPORT_URL_KEYS.from]: { default: "", isValid: isDateOrEmpty },
  [FINANCE_REPORT_URL_KEYS.to]: { default: "", isValid: isDateOrEmpty },
  [FINANCE_REPORT_URL_KEYS.student]: { default: "", isValid: isUuidOrEmpty },
  [FINANCE_REPORT_URL_KEYS.group]: {
    default: DEFAULT_FINANCE_REPORT_GROUPING,
    isValid: (value: string) => Object.hasOwn(GROUP_BY_SET, value),
  },
  [FINANCE_REPORT_URL_KEYS.campus]: { default: "", isValid: isUuidOrEmpty },
  [FINANCE_REPORT_URL_KEYS.session]: { default: "", isValid: isUuidOrEmpty },
  [FINANCE_REPORT_URL_KEYS.class]: { default: "", isValid: isUuidOrEmpty },
};

/** The report table keeps the server's row order, and its columns change with the kind. */
export const FINANCE_REPORT_SORTABLE_IDS: readonly string[] = [];
export const FINANCE_REPORT_DEFAULT_SORTING: { id: string; desc: boolean }[] = [];
export const FINANCE_REPORT_HIDEABLE_IDS: readonly string[] = [];

type QueryField = Exclude<keyof FinanceReportQuery, "kind">;

/** camelCase `FinanceReportQuery` key -> the report's query param (and the export's body key);
 * `kind` is always sent. */
export const FINANCE_REPORT_QUERY_FIELDS: ReadonlyArray<readonly [QueryField, string]> = [
  ["dateFrom", "date_from"],
  ["dateTo", "date_to"],
  ["studentId", "student"],
  ["groupBy", "group_by"],
  ["campusId", "campus_id"],
  ["academicSessionId", "academic_session_id"],
  ["classId", "class_id"],
];

/** The downloaded file's name hint (the server's `Content-Disposition` wins cross-origin). */
export const FINANCE_REPORT_FILENAME_PREFIX = "fees-report";

/** `meta.row_limit` on the 422 a too-large report answers with. */
export const FINANCE_REPORT_ROW_LIMIT_META_KEY = "row_limit";
