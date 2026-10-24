import type { PermissionKey } from "@schoolhub/types";
import { SORT_NONE } from "@/lib/constants";
import { isUuid } from "@/lib/helpers";
import type { PromotionBatchFormValues, PromotionDecisionFormValues } from "./promotions.schema";
import type {
  PromotionAction,
  PromotionBatchesQuery,
  PromotionDecisionValue,
  PromotionStatus,
  UpdateDecisionInput,
} from "./promotions-type";

/** The promotions module's constants. */

/** The batch statuses, named once so a comparison never spells one: a status the API adds is a
 * compile error here until it is listed. Declared in the order a batch moves through them. */
export const PROMOTION_STATUS = {
  draft: "draft",
  pending_approval: "pending_approval",
  approved: "approved",
  executed: "executed",
  reverted: "reverted",
} as const satisfies Record<PromotionStatus, PromotionStatus>;

/** Every batch status, in lifecycle order: the status filter's options. */
export const PROMOTION_STATUSES: readonly PromotionStatus[] = Object.values(PROMOTION_STATUS);

/** The decisions a student's row can carry, named once for the same reason as the statuses. */
export const PROMOTION_DECISION = {
  promoted: "promoted",
  retained: "retained",
  promoted_on_trial: "promoted_on_trial",
  graduated: "graduated",
} as const satisfies Record<PromotionDecisionValue, PromotionDecisionValue>;

/** Every decision, in the API's order: the decision picker's options. */
export const PROMOTION_DECISIONS: readonly PromotionDecisionValue[] =
  Object.values(PROMOTION_DECISION);

/** The decisions a proposal never makes (it is promoted or graduated), so the server asks for an
 * override reason for them even on a row with no recorded proposal. */
export const PROMOTION_UNPROPOSED_DECISIONS: readonly PromotionDecisionValue[] = [
  PROMOTION_DECISION.retained,
  PROMOTION_DECISION.promoted_on_trial,
];

/** Every action a reviewer can take on a batch, named once so a comparison never spells one. */
export const PROMOTION_ACTION = {
  submit: "submit",
  approve: "approve",
  reject: "reject",
  execute: "execute",
  revert: "revert",
} as const satisfies Record<PromotionAction, PromotionAction>;

/** The permission key each action needs (`docs/03-modules/academics.md` §4); reject shares
 * approve's. The API enforces these: the screen only decides what to offer. */
export const PROMOTION_ACTION_PERMISSION = {
  [PROMOTION_ACTION.submit]: "academics.promotion.update",
  [PROMOTION_ACTION.approve]: "academics.promotion.approve",
  [PROMOTION_ACTION.reject]: "academics.promotion.approve",
  [PROMOTION_ACTION.execute]: "academics.promotion.execute",
  [PROMOTION_ACTION.revert]: "academics.promotion.update",
} as const satisfies Record<PromotionAction, PermissionKey>;

/** The key a decision row's Edit needs (the batch must also be a draft). */
export const PROMOTION_DECISION_EDIT_PERMISSION =
  "academics.promotion.update" as const satisfies PermissionKey;

/** The actions each status offers, in the order their buttons read. Typed over every status, so
 * a status the API adds is a compile error here until it is given its actions. */
export const PROMOTION_STATUS_ACTIONS: Record<PromotionStatus, readonly PromotionAction[]> = {
  [PROMOTION_STATUS.draft]: [PROMOTION_ACTION.submit, PROMOTION_ACTION.revert],
  [PROMOTION_STATUS.pending_approval]: [
    PROMOTION_ACTION.approve,
    PROMOTION_ACTION.reject,
    PROMOTION_ACTION.revert,
  ],
  [PROMOTION_STATUS.approved]: [PROMOTION_ACTION.execute, PROMOTION_ACTION.revert],
  [PROMOTION_STATUS.executed]: [PROMOTION_ACTION.revert],
  [PROMOTION_STATUS.reverted]: [],
};

/** The actions that undo or refuse work: their button and their confirm are destructive. */
export const PROMOTION_DESTRUCTIVE_ACTIONS: readonly PromotionAction[] = [
  PROMOTION_ACTION.reject,
  PROMOTION_ACTION.revert,
];

/** The statuses in which a batch's target sections matter: a row with none fails on execute. */
export const PROMOTION_SECTION_ADVISORY_STATUSES: readonly PromotionStatus[] = [
  PROMOTION_STATUS.draft,
  PROMOTION_STATUS.approved,
];

/** The target-section select's value for "no section", as a `SelectItem` can't hold `""`. */
export const PROMOTION_NO_SECTION = SORT_NONE;

/**
 * The query-key module and resources the promotion screens read under: the batch list under
 * `queryKeys.list(PROMOTION_QUERY_MODULE, PROMOTION_BATCHES_RESOURCE, params)`, one batch under
 * `queryKeys.detail(PROMOTION_QUERY_MODULE, PROMOTION_BATCH_RESOURCE, batchId)`. A write
 * invalidates those two and never the bare `["promotions"]`: the execute job's `jobWatch` key
 * shares that prefix, so it would refetch a poll that is running.
 */
export const PROMOTION_QUERY_MODULE = "promotions";
export const PROMOTION_BATCHES_RESOURCE = "batches";
export const PROMOTION_BATCH_RESOURCE = "batch";

/** The query-key module the `promotion.execute` job is polled under (`useJobPolling`). */
export const PROMOTION_EXECUTE_JOB_MODULE = PROMOTION_QUERY_MODULE;

/** The create form's inputs, named as the API names them: a server error on one shows under it. */
export const PROMOTION_CREATE_FIELDS = [
  "from_academic_session_id",
  "to_academic_session_id",
  "class_id",
] as const satisfies readonly (keyof PromotionBatchFormValues)[];

/** The decision editor's inputs, named as the API names them: a server error on one shows
 * under it. */
export const PROMOTION_DECISION_FIELDS = [
  "decision",
  "to_class_id",
  "to_section_id",
  "override_reason",
  "remarks",
] as const satisfies readonly (keyof PromotionDecisionFormValues)[];

const PROMOTION_STATUS_VALUES: readonly string[] = PROMOTION_STATUSES;

/** The list's URL filters (`useDataGridUrlState`): URL key -> default and validator. `""` is no
 * filter. Every id must be a UUID, so a hand-edited value is never sent to the API. */
export const PROMOTION_URL_FILTERS = {
  status: {
    default: "",
    isValid: (value: string) => PROMOTION_STATUS_VALUES.includes(value),
  },
  session: { default: "", isValid: isUuid },
  class: { default: "", isValid: isUuid },
};

/** Column id -> the `?ordering=` field the `/student-promotions` list accepts. */
export const PROMOTION_SORT_FIELD: Record<string, string> = {
  status: "status",
  students: "students",
  startedAt: "started_at",
};

/** Column ids the list may be sorted by: the `sort` values the URL is allowed to carry. */
export const PROMOTION_SORTABLE_IDS = Object.keys(PROMOTION_SORT_FIELD);

/** No sort, so the API's own order applies: newest batch first (`-started_at`). */
export const PROMOTION_DEFAULT_SORTING: { id: string; desc: boolean }[] = [];

/** Longest `override_reason` and `remarks` (`docs/05-database/entities/academics.md`). */
export const OVERRIDE_REASON_MAX = 500;
export const REMARKS_MAX = 500;

/** One camelCase input key and the snake_case key the API calls it. */
type MappedField<T> = readonly [keyof T, string];

/** `PromotionBatchesQuery` key -> the list endpoint's query param. Drives
 * `toPromotionQueryParams`. */
export const PROMOTION_QUERY_FIELDS: ReadonlyArray<MappedField<PromotionBatchesQuery>> = [
  ["page", "page"],
  ["pageSize", "page_size"],
  ["ordering", "ordering"],
  ["status", "status"],
  ["fromAcademicSessionId", "from_academic_session_id"],
  ["fromClassId", "from_class_id"],
];

/** `UpdateDecisionInput` key -> the API's PATCH body key. Drives `toDecisionBody`. */
export const PROMOTION_DECISION_BODY_FIELDS: ReadonlyArray<MappedField<UpdateDecisionInput>> = [
  ["decision", "decision"],
  ["toClassId", "to_class_id"],
  ["toSectionId", "to_section_id"],
  ["overrideReason", "override_reason"],
  ["remarks", "remarks"],
];
