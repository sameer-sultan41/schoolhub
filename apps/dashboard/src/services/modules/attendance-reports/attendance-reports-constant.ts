import { isIsoDate, isUuid } from "@/lib/helpers";
import type {
  ReportFormat,
  ReportKind,
  ReportKindFields,
  ReportQuery,
} from "./attendance-reports-type";

/** The attendance-reports module's constants. */

/** The query-key module a report run lives under, and the job watches its exports use. */
export const ATTENDANCE_REPORTS_QUERY_MODULE = "attendance-reports";
export const REPORT_RESOURCE = "report";

/** Which inputs each kind takes, keyed so the compiler checks it against the generated enum. */
export const REPORT_KIND_FIELDS: Record<ReportKind, ReportKindFields> = {
  "daily-register": { singleDate: true, section: true, period: true, threshold: false },
  "student-summary": { singleDate: false, section: true, period: false, threshold: false },
  defaulters: { singleDate: false, section: true, period: false, threshold: true },
  "student-late-arrivals": { singleDate: false, section: true, period: false, threshold: false },
  "staff-punctuality": { singleDate: false, section: false, period: false, threshold: false },
  leave: { singleDate: false, section: false, period: false, threshold: false },
};

/** The kinds in the picker's order (`services.REPORT_KINDS`). */
export const REPORT_KINDS: readonly ReportKind[] = [
  "daily-register",
  "student-summary",
  "defaulters",
  "student-late-arrivals",
  "staff-punctuality",
  "leave",
];

export const DEFAULT_REPORT_KIND: ReportKind = "student-summary";

/** `reports.DEFAULT_DEFAULTER_THRESHOLD`: the form's starting value. */
export const DEFAULT_DEFAULTER_THRESHOLD = "75";

/** A range report opens on this many calendar days, today included. */
export const REPORT_DEFAULT_RANGE_DAYS = 30;

/** The export formats (`core.imports.tabular.FORMATS`), in the buttons' order. */
export const REPORT_EXPORT_FORMATS: readonly ReportFormat[] = ["csv", "xlsx", "pdf"];

/** The format a large inline run is built in: the API's default. */
export const QUEUED_REPORT_FORMAT: ReportFormat = "csv";

/** A rate and an average are shown to exactly one decimal place (day counts: `formatLeaveDays`). */
export const REPORT_FRACTION_DIGITS = 1;

/** The report form's URL keys. */
export const REPORT_URL_KEYS = {
  kind: "kind",
  from: "from",
  to: "to",
  class: "class",
  section: "section",
  period: "period",
  threshold: "threshold",
} as const;

const isDateOrEmpty = (value: string) => value === "" || isIsoDate(value);
const isUuidOrEmpty = (value: string) => value === "" || isUuid(value);

/**
 * The report form's URL filters (`useDataGridUrlState`). A blank date is the default (today, or
 * the last `REPORT_DEFAULT_RANGE_DAYS` days). The threshold is kept as typed and checked when
 * the report is built, so a half-typed value is not wiped from its input.
 */
export const REPORT_URL_FILTERS = {
  [REPORT_URL_KEYS.kind]: {
    default: DEFAULT_REPORT_KIND,
    isValid: (value: string) => Object.hasOwn(REPORT_KIND_FIELDS, value),
  },
  [REPORT_URL_KEYS.from]: { default: "", isValid: isDateOrEmpty },
  [REPORT_URL_KEYS.to]: { default: "", isValid: isDateOrEmpty },
  [REPORT_URL_KEYS.class]: { default: "", isValid: isUuidOrEmpty },
  [REPORT_URL_KEYS.section]: { default: "", isValid: isUuidOrEmpty },
  [REPORT_URL_KEYS.period]: { default: "", isValid: isUuidOrEmpty },
  [REPORT_URL_KEYS.threshold]: { default: DEFAULT_DEFAULTER_THRESHOLD, isValid: () => true },
};

/** The report table keeps the server's row order, and its columns change with the kind. */
export const REPORT_SORTABLE_IDS: readonly string[] = [];
export const REPORT_DEFAULT_SORTING: { id: string; desc: boolean }[] = [];
export const REPORT_HIDEABLE_IDS: readonly string[] = [];

type ReportQueryField = Exclude<keyof ReportQuery, "kind">;

/** camelCase `ReportQuery` key -> the report's query param; `kind` is always sent. */
export const REPORT_QUERY_FIELDS: ReadonlyArray<readonly [ReportQueryField, string]> = [
  ["startDate", "start_date"],
  ["endDate", "end_date"],
  ["sectionId", "section_id"],
  ["periodId", "period_id"],
  ["threshold", "threshold"],
];

/** The downloaded file's name hint (the server's `Content-Disposition` wins cross-origin). */
export const REPORT_FILENAME_PREFIX = "attendance-report";
