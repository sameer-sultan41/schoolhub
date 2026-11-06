import { FILTER_ALL } from "@/lib/constants";
import { isUuid } from "@/lib/helpers";
import { EXAMS_QUERY_MODULE } from "@/services/modules/exams/exams-constant";
import type { ExamStatus } from "@/services/modules/exams/exams-type";
import type { AdmitCardPageQuery, AdmitCardStatus } from "./admit-cards-type";

/** The admit-cards module's constants. */

/** The cards sit under the exams module's key, so a publish (which moves the exam's status) or an
 * issue refreshes them with the exam's other reads. */
export const ADMIT_CARDS_QUERY_MODULE = EXAMS_QUERY_MODULE;
export const ADMIT_CARDS_LIST_RESOURCE = "admit-cards";
/** Namespaces the issue job's poll (`useJobPolling`). */
export const ADMIT_CARDS_JOB_MODULE = "admit-cards";

/** Rows per page: the cursor list has no page-size picker. */
export const ADMIT_CARDS_PAGE_SIZE = 25;
/** By card number, which is the exam's prefix plus the admission number (`ordering_fields`). */
export const ADMIT_CARDS_ORDERING = "admit_card_no";

export const ADMIT_CARD_STATUS_REVOKED: AdmitCardStatus = "revoked";

/** Every status, keyed so the compiler checks the set against the generated enum. */
const STATUS_SET: Record<AdmitCardStatus, true> = {
  generated: true,
  issued: true,
  revoked: true,
};
export const ADMIT_CARD_STATUSES = Object.keys(STATUS_SET) as AdmitCardStatus[];

const STATUS_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...ADMIT_CARD_STATUSES];

/** The tab's URL filters (`useDataGridUrlState`): every card, every section, by default. */
export const ADMIT_CARD_URL_FILTERS = {
  section: { default: "", isValid: (value: string) => value === "" || isUuid(value) },
  status: {
    default: FILTER_ALL,
    isValid: (value: string) => STATUS_FILTER_VALUES.includes(value),
  },
};

/** The list has no sortable column; the sort is fixed (`ADMIT_CARDS_ORDERING`). */
export const ADMIT_CARD_SORTABLE_IDS: readonly string[] = [];
export const ADMIT_CARD_DEFAULT_SORTING: { id: string; desc: boolean }[] = [];
export const ADMIT_CARD_ACTIONS_COLUMN_ID = "actions";

/** camelCase `AdmitCardPageQuery` key -> the list's query param; the page size goes first. */
export const ADMIT_CARD_QUERY_FIELDS: ReadonlyArray<readonly [keyof AdmitCardPageQuery, string]> = [
  ["examId", "exam_id"],
  ["cursor", "cursor"],
  ["ordering", "ordering"],
  ["sectionId", "section_id"],
  ["status", "status"],
];

/** `AdmitCardRevokeSerializer.reason`'s `max_length`. */
export const REVOKE_REASON_MAX_LENGTH = 255;
/** The fields a server error may name on the revoke form: the reason is its only input. */
export const REVOKE_ERROR_FIELDS = ["reason"] as const;

/** Cards print a published schedule, so a draft exam issues none (`assert_exam_is_issuable`). */
export const NOT_ISSUABLE_EXAM_STATUS: ExamStatus = "draft";
