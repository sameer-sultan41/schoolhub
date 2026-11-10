import type { PermissionKey } from "@schoolhub/types";

import { FILTER_ALL } from "@/lib/constants";
import { isUuid } from "@/lib/helpers";
import { EXAMS_QUERY_MODULE } from "@/services/modules/exams/exams-constant";
import type { ExamStatus } from "@/services/modules/exams/exams-type";
import type {
  ReportCardPageQuery,
  ReportCardRemarkField,
  ReportCardStatus,
} from "./report-cards-type";

/** The report-cards module's constants. */

/** The cards sit under the exams module's key, so a results send-back or publish refreshes them. */
export const REPORT_CARDS_QUERY_MODULE = EXAMS_QUERY_MODULE;
export const REPORT_CARDS_LIST_RESOURCE = "report-cards";
/** The exam tab's id (`?tab=report-cards`). */
export const REPORT_CARDS_TAB_ID = "report-cards";
/** Namespaces the generation job's poll (`useJobPolling`). */
export const REPORT_CARDS_JOB_MODULE = "report-cards";

/** Rows per page: the cursor list has no page-size picker. */
export const REPORT_CARDS_PAGE_SIZE = 25;
/** Newest first (`ordering_fields`); a regenerated card moves to the top. */
export const REPORT_CARDS_ORDERING = "-created_at";

export const REPORT_CARD_STATUS_PUBLISHED: ReportCardStatus = "published";

/** Every status, keyed so the compiler checks the set against the generated enum. */
const STATUS_SET: Record<ReportCardStatus, true> = {
  draft: true,
  generated: true,
  published: true,
};
export const REPORT_CARD_STATUSES = Object.keys(STATUS_SET) as ReportCardStatus[];

const STATUS_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...REPORT_CARD_STATUSES];

/** The tab's URL filters (`useDataGridUrlState`): every card of every section by default. */
export const REPORT_CARD_URL_FILTERS = {
  section: { default: "", isValid: (value: string) => value === "" || isUuid(value) },
  status: {
    default: FILTER_ALL,
    isValid: (value: string) => STATUS_FILTER_VALUES.includes(value),
  },
};

/** The list has no sortable column; the sort is fixed (`REPORT_CARDS_ORDERING`). */
export const REPORT_CARD_SORTABLE_IDS: readonly string[] = [];
export const REPORT_CARD_DEFAULT_SORTING: { id: string; desc: boolean }[] = [];
export const REPORT_CARD_ACTIONS_COLUMN_ID = "actions";

/** camelCase `ReportCardPageQuery` key -> the list's query param; the page size goes first. */
type QueryField = readonly [keyof ReportCardPageQuery, string];
export const REPORT_CARD_QUERY_FIELDS: readonly QueryField[] = [
  ["examId", "exam_id"],
  ["cursor", "cursor"],
  ["ordering", "ordering"],
  ["sectionId", "section_id"],
  ["status", "status"],
];

/** Each remark field and the key that writes it (`ReportCardViewSet.REMARK_FIELD_KEYS`, §4). */
export const REMARK_FIELD_KEYS: ReadonlyArray<readonly [ReportCardRemarkField, PermissionKey]> = [
  ["class_teacher_remarks", "exams.report-card.create"],
  ["principal_remarks", "exams.report-card.publish"],
];

/** `ReportCard.class_teacher_remarks` / `principal_remarks` `max_length`. */
export const REMARKS_MAX_LENGTH = 1000;

/** Cards are generated, and published, from published results (§11). */
export const REPORT_CARDS_EXAM_STATUS: ExamStatus = "published";
