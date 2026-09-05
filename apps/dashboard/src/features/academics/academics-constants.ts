import type {
  PromotionDecisionValue,
  PromotionStatusValue,
} from "@/features/academics/academics-types";

/** Page size sent to every academics list — mirrors the API's own cursor default
 * (core.api.pagination.CursorPagination), kept explicit here so the UI's row
 * count is a deliberate choice. Same reasoning as staff-constants.ts. */
export const ACADEMICS_PAGE_SIZE = 25;

/** Mirrors `services.DEFAULT_WEEKLY_PERIOD_NORM`. The server is the authority —
 * `over_norm` on each load-summary row is computed there; this is only used to
 * label the threshold in the UI. */
export const DEFAULT_WEEKLY_PERIOD_NORM = 30;

/**
 * Sentinel for "no filter" in a Select — kept out of the request params entirely
 * rather than sent as an empty string, so `{}` and `{status: ""}` are the same
 * cache key. Mirrors staff-table.tsx's ALL exactly.
 */
export const ALL = "__all__";

export const PROMOTION_DECISIONS: PromotionDecisionValue[] = [
  "promoted",
  "retained",
  "promoted_on_trial",
  "graduated",
];

export const PROMOTION_STATUSES: PromotionStatusValue[] = [
  "draft",
  "pending_approval",
  "approved",
  "executed",
  "reverted",
];

/** Badge colour per batch state (§7.2). Token utilities only — the variants map
 * to `--sh-*` custom properties, never to a literal colour. */
export const PROMOTION_STATUS_BADGE: Record<
  PromotionStatusValue,
  "secondary" | "success" | "warning" | "danger"
> = {
  draft: "secondary",
  pending_approval: "warning",
  approved: "success",
  executed: "success",
  reverted: "danger",
};
