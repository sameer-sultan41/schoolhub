import { FILTER_ALL } from "@/lib/constants";
import type {
  GradeBandInput,
  GradingScaleInput,
  GradingScalePageQuery,
  GradingScaleType,
} from "./grading-scales-type";

/** The grading-scales module's constants. */

/** The query-key module every scale read lives under; a scale or band write invalidates it. */
export const GRADING_SCALES_QUERY_MODULE = "grading-scales";
export const GRADING_SCALES_LIST_RESOURCE = "list";
export const GRADING_SCALES_BANDS_RESOURCE = "bands";
/** A picker's read of the scales (an exam form): one page at the API's maximum, as a school has a handful. */
export const GRADING_SCALES_OPTIONS_RESOURCE = "options";
export const GRADING_SCALES_OPTIONS_PAGE_SIZE = 100;

/** Every scale type, keyed so the compiler checks the set against the generated enum. */
const SCALE_TYPE_SET: Record<GradingScaleType, true> = {
  percentage: true,
  letter: true,
  gpa: true,
  hybrid: true,
};
export const SCALE_TYPES = Object.keys(SCALE_TYPE_SET) as GradingScaleType[];

/** A new scale is a letter scale unless said otherwise (the model's default). */
export const DEFAULT_SCALE_TYPE: GradingScaleType = "letter";

/** A GPA or hybrid scale needs a maximum grade point (`grading_scales_gpa_max_present`). */
export const GPA_SCALE_TYPES: readonly GradingScaleType[] = ["gpa", "hybrid"];

/** Column id -> the `?ordering=` field `/grading-scales` accepts. */
export const GRADING_SCALES_SORT_FIELD: Record<string, string> = { name: "name" };
export const GRADING_SCALES_SORTABLE_IDS = Object.keys(GRADING_SCALES_SORT_FIELD);
export const GRADING_SCALES_DEFAULT_SORTING: { id: string; desc: boolean }[] = [
  { id: "name", desc: false },
];

/** The table's `actions` column id: hidden for a viewer with no write key. */
export const GRADING_SCALES_ACTIONS_COLUMN_ID = "actions";

const SCALE_TYPE_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...SCALE_TYPES];

/** The list's URL filters (`useDataGridUrlState`). */
export const GRADING_SCALES_URL_FILTERS = {
  type: {
    default: FILTER_ALL,
    isValid: (value: string) => SCALE_TYPE_FILTER_VALUES.includes(value),
  },
};

/** The column limits (`examinations.models`). */
export const SCALE_NAME_MAX = 100;
export const SCALE_DESCRIPTION_MAX = 500;
export const BAND_LABEL_MAX = 20;
export const BAND_REMARK_MAX = 100;

/** A percentage's range, and the seam two bands may leave between them: the column holds two
 * decimals, so the next value after 49.99 is 50 (`grading.assert_scale_is_complete`). */
export const PERCENT_MIN = 0;
export const PERCENT_MAX = 100;
export const PERCENT_STEP_HUNDREDTHS = 1;
export const HUNDREDTHS_PER_UNIT = 100;

/** A decimal as the API stores it: digits, with up to two after the point. */
export const DECIMAL_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;

/** camelCase `GradingScaleInput` key -> the API's body key. */
export const GRADING_SCALES_BODY_FIELDS: ReadonlyArray<readonly [keyof GradingScaleInput, string]> =
  [
    ["name", "name"],
    ["scaleType", "scale_type"],
    ["gpaMax", "gpa_max"],
    ["description", "description"],
  ];

/** camelCase `GradeBandInput` key -> the API's body key. */
export const GRADE_BANDS_BODY_FIELDS: ReadonlyArray<readonly [keyof GradeBandInput, string]> = [
  ["label", "label"],
  ["minPercent", "min_percent"],
  ["maxPercent", "max_percent"],
  ["gradePoint", "grade_point"],
  ["isPassing", "is_passing"],
  ["remark", "remark"],
  ["sortOrder", "sort_order"],
];

/** camelCase `GradingScalePageQuery` key -> the `/grading-scales` query param. */
export const GRADING_SCALES_QUERY_FIELDS: ReadonlyArray<
  readonly [keyof GradingScalePageQuery, string]
> = [
  ["search", "search"],
  ["ordering", "ordering"],
  ["scaleType", "scale_type"],
];

/** The fields a server error may name on the scale form; any other shows as the form's message. */
export const SCALE_ERROR_FIELDS = ["name", "scale_type", "gpa_max", "description"] as const;

/** The fields a server error may name on the band form. */
export const BAND_ERROR_FIELDS = [
  "label",
  "min_percent",
  "max_percent",
  "grade_point",
  "is_passing",
  "remark",
  "sort_order",
] as const;
