import { FILTER_ALL } from "@/lib/constants";
import { copyMappedFields } from "@/lib/helpers";
import {
  DEFAULT_SCALE_TYPE,
  GPA_SCALE_TYPES,
  GRADE_BANDS_BODY_FIELDS,
  GRADING_SCALES_BODY_FIELDS,
  GRADING_SCALES_QUERY_FIELDS,
  HUNDREDTHS_PER_UNIT,
  PERCENT_MAX,
  PERCENT_MIN,
  PERCENT_STEP_HUNDREDTHS,
} from "./grading-scales-constant";
import type { BandFormValues, ScaleFormValues } from "./grading-scales.schema";
import type {
  CoverageIssue,
  GradeBandInput,
  GradeBandRecord,
  GradingScaleInput,
  GradingScalePageQuery,
  GradingScaleRecord,
  GradingScaleType,
} from "./grading-scales-type";

/** The grading-scales module's pure helpers: plain data in, plain data out. */

export function toScaleBody(input: Partial<GradingScaleInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, GRADING_SCALES_BODY_FIELDS, (value) => value !== undefined, body);
  return body;
}

export function toBandBody(input: Partial<GradeBandInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, GRADE_BANDS_BODY_FIELDS, (value) => value !== undefined, body);
  return body;
}

export function toScaleQueryParams(
  query: GradingScalePageQuery,
): Record<string, string | number | undefined> {
  const params: Record<string, unknown> = { page: query.page, page_size: query.pageSize };
  copyMappedFields(
    query,
    GRADING_SCALES_QUERY_FIELDS,
    (value) => value !== undefined && value !== "",
    params,
  );
  return params as Record<string, string | number | undefined>;
}

/** The type filter -> `scale_type`: `all` is no filter. */
export function typeFilterToScaleType(type: string): GradingScaleType | undefined {
  return type === FILTER_ALL ? undefined : (type as GradingScaleType);
}

/** Trimmed, with a blank as `null`, which clears a stored value. */
function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function defaultScaleFormValues(): ScaleFormValues {
  return { name: "", scale_type: DEFAULT_SCALE_TYPE, gpa_max: "", description: "" };
}

export function recordToScaleFormValues(record: GradingScaleRecord): ScaleFormValues {
  return {
    name: record.name,
    scale_type: record.scale_type ?? DEFAULT_SCALE_TYPE,
    gpa_max: record.gpa_max ?? "",
    description: record.description ?? "",
  };
}

/** Form values -> the service input. A percentage or letter scale has no maximum grade point,
 * so one left in the form from an earlier type is not sent. */
export function buildScaleInput(values: ScaleFormValues): GradingScaleInput {
  return {
    name: values.name.trim(),
    scaleType: values.scale_type,
    gpaMax: GPA_SCALE_TYPES.includes(values.scale_type) ? blankToNull(values.gpa_max) : null,
    description: blankToNull(values.description),
  };
}

export function defaultBandFormValues(sortOrder: number): BandFormValues {
  return {
    label: "",
    min_percent: "",
    max_percent: "",
    grade_point: "",
    is_passing: true,
    remark: "",
    sort_order: String(sortOrder),
  };
}

export function recordToBandFormValues(record: GradeBandRecord): BandFormValues {
  return {
    label: record.label,
    min_percent: record.min_percent,
    max_percent: record.max_percent,
    grade_point: record.grade_point ?? "",
    is_passing: record.is_passing ?? true,
    remark: record.remark ?? "",
    sort_order: String(record.sort_order ?? 0),
  };
}

export function buildBandInput(values: BandFormValues): GradeBandInput {
  return {
    label: values.label.trim(),
    minPercent: values.min_percent.trim(),
    maxPercent: values.max_percent.trim(),
    gradePoint: blankToNull(values.grade_point),
    isPassing: values.is_passing,
    remark: blankToNull(values.remark),
    sortOrder: Number(values.sort_order.trim()),
  };
}

/** The next free place in the display order, after the last band. */
export function nextSortOrder(bands: readonly Pick<GradeBandRecord, "sort_order">[]): number {
  return bands.reduce((highest, band) => Math.max(highest, (band.sort_order ?? 0) + 1), 0);
}

/** A decimal string in hundredths of a percent: whole numbers, so the seam arithmetic never
 * meets a float's rounding. */
function toHundredths(value: string): number {
  return Math.round(Number(value) * HUNDREDTHS_PER_UNIT);
}

/**
 * The advisory coverage check on a scale's bands, as `grading.assert_scale_is_complete` reads
 * them on the server (the check that stops an exam using a scale): sorted by lower bound, the
 * lowest must start at 0, the highest end at 100, and neighbours must meet with no shared
 * percentage and no seam wider than a hundredth. Advisory here, since a scale is built a band
 * at a time and every step along the way is incomplete; the server is what refuses.
 */
export function checkBandCoverage(
  bands: readonly Pick<GradeBandRecord, "label" | "min_percent" | "max_percent">[],
): CoverageIssue[] {
  if (bands.length === 0) return [{ kind: "empty" }];

  const ordered = [...bands].sort(
    (a, b) => toHundredths(a.min_percent) - toHundredths(b.min_percent),
  );
  const issues: CoverageIssue[] = [];

  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  if (first && toHundredths(first.min_percent) !== PERCENT_MIN * HUNDREDTHS_PER_UNIT) {
    issues.push({ kind: "start", at: first.min_percent });
  }
  if (last && toHundredths(last.max_percent) !== PERCENT_MAX * HUNDREDTHS_PER_UNIT) {
    issues.push({ kind: "end", at: last.max_percent });
  }

  ordered.slice(1).forEach((upper, index) => {
    const lower = ordered[index];
    if (!lower) return;
    const pair = {
      lower: lower.label,
      upper: upper.label,
      from: lower.max_percent,
      to: upper.min_percent,
    };
    const seam = toHundredths(upper.min_percent) - toHundredths(lower.max_percent);
    if (seam <= 0) issues.push({ kind: "overlap", ...pair });
    else if (seam > PERCENT_STEP_HUNDREDTHS) issues.push({ kind: "gap", ...pair });
  });

  return issues;
}
