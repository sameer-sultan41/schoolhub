import { copyMappedFields } from "@/lib/helpers";
import {
  PERIOD_KIND,
  PERIOD_MIN_SEQUENCE,
  PERIOD_TIME_LENGTH,
  PERIOD_WEEKDAYS,
  PERIODS_BODY_FIELDS,
  PERIODS_QUERY_FIELDS,
} from "./periods-constant";
import type { PeriodFormValues } from "./periods.schema";
import type { PeriodInput, PeriodPageQuery, PeriodRecord } from "./periods-type";

/** The periods module's pure helpers: plain data in, plain data out. */

/** `PeriodInput` -> the API body. `null` is kept: it is how "every campus" and "the working
 * days" are said. */
export function toPeriodBody(input: Partial<PeriodInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, PERIODS_BODY_FIELDS, (value) => value !== undefined, body);
  return body;
}

/** `PeriodPageQuery` -> `/periods` query params; unset and empty filters are omitted, and
 * `isBreak: false` is kept (it filters to teaching periods). */
export function toPeriodQueryParams(
  query: PeriodPageQuery,
): Record<string, string | number | boolean | undefined> {
  const params: Record<string, unknown> = { page: query.page, page_size: query.pageSize };
  copyMappedFields(
    query,
    PERIODS_QUERY_FIELDS,
    (value) => value !== undefined && value !== "",
    params,
  );
  return params as Record<string, string | number | boolean | undefined>;
}

/** The kind filter -> `is_break`: `all` (or anything else) is no filter. */
export function kindToIsBreak(kind: string): boolean | undefined {
  if (kind === PERIOD_KIND.teaching) return false;
  if (kind === PERIOD_KIND.break) return true;
  return undefined;
}

/** `HH:MM:SS` -> `HH:MM`, the form's and the table's shape. */
export function toShortTime(time: string): string {
  return time.slice(0, PERIOD_TIME_LENGTH);
}

/** The record's days, with an omitted value read as `null` (the tenant's working days). */
export function periodWeekdays(record: PeriodRecord): number[] | null {
  return record.weekdays ?? null;
}

/** A `YYYY-MM-DD` date's weekday as `Period.weekdays` numbers it, Monday (0) to Sunday (6). */
export function periodWeekdayOf(isoDate: string): number {
  // `getUTCDay` counts from Sunday (0); shift it so Monday is 0.
  const sundayBased = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return (sundayBased + PERIOD_WEEKDAYS.length - 1) % PERIOD_WEEKDAYS.length;
}

/** The lesson periods (no breaks) that run on `isoDate`; a period with no days of its own runs
 * on the tenant's working days, which the server checks. A register is taken per lesson only. */
export function lessonPeriodsOn(periods: readonly PeriodRecord[], isoDate: string): PeriodRecord[] {
  const weekday = periodWeekdayOf(isoDate);
  return periods.filter(
    (period) => !period.is_break && (periodWeekdays(period)?.includes(weekday) ?? true),
  );
}

/** A new period's form values: every campus, the tenant's working days. */
export function defaultPeriodFormValues(): PeriodFormValues {
  return {
    campus_id: "",
    name: "",
    sequence: PERIOD_MIN_SEQUENCE,
    start_time: "",
    end_time: "",
    is_break: false,
    weekdays: [],
  };
}

export function recordToPeriodFormValues(record: PeriodRecord): PeriodFormValues {
  return {
    campus_id: record.campus_id ?? "",
    name: record.name,
    sequence: record.sequence,
    start_time: toShortTime(record.start_time),
    end_time: toShortTime(record.end_time),
    is_break: record.is_break ?? false,
    weekdays: periodWeekdays(record) ?? [],
  };
}

/** Form values -> the service input. Every field is editable, so create and edit send the
 * same body; an emptied campus or day list is `null`, which clears it. Days go in week order. */
export function buildPeriodInput(values: PeriodFormValues): PeriodInput {
  return {
    campusId: values.campus_id === "" ? null : values.campus_id,
    name: values.name.trim(),
    sequence: values.sequence,
    startTime: values.start_time,
    endTime: values.end_time,
    isBreak: values.is_break,
    weekdays: values.weekdays.length === 0 ? null : [...values.weekdays].sort((a, b) => a - b),
  };
}
