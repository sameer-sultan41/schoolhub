/**
 * API contract primitives — the response envelope, error shape, and pagination
 * defined in `DOCS/docs/02-architecture/api-architecture.md` §2.3–§2.4.
 *
 * Field names are snake_case because they mirror the wire format exactly; do not
 * camelCase them on the way in.
 */

/** Cursor pagination is the default; `?cursor=…&page_size=25` (max 100). */
export interface CursorPagination {
  /** Opaque cursor for the next page, or `null` on the last page. */
  next_cursor: string | null;
  /** Opaque cursor for the previous page, or `null` on the first page. */
  previous_cursor: string | null;
  /** Page size the server actually applied (may be clamped to the 100 max). */
  page_size: number;
  /** Total count — only present on endpoints cheap enough to count. */
  total_count?: number;
}

/** Offset pagination is allowed only on small admin lists. */
export interface OffsetPagination {
  page: number;
  page_size: number;
  total_count: number;
  total_pages: number;
}

export type Pagination = CursorPagination | OffsetPagination;

export function isCursorPagination(pagination: Pagination): pagination is CursorPagination {
  return "next_cursor" in pagination;
}

export interface ApiMeta {
  pagination?: Pagination;
  [key: string]: unknown;
}

/** Success envelope: `{ "data": …, "meta": { … } }`. */
export interface ApiSuccessEnvelope<TData> {
  data: TData;
  meta?: ApiMeta;
}

/** One field-level problem inside an error envelope. */
export interface ApiErrorDetail {
  /** Dotted path of the offending field, e.g. `guardians.0.email`. */
  field?: string;
  issue: string;
  code?: string;
}

/**
 * Error envelope (RFC 9457 problem-details style):
 * `{ "error": { "code", "message", "details", "request_id" } }`.
 */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: ApiErrorDetail[];
  request_id: string;
}

export interface ApiErrorEnvelope {
  error: ApiErrorBody;
}

export type ApiEnvelope<TData> = ApiSuccessEnvelope<TData> | ApiErrorEnvelope;

export function isErrorEnvelope<TData>(
  envelope: ApiEnvelope<TData>,
): envelope is ApiErrorEnvelope {
  return typeof envelope === "object" && envelope !== null && "error" in envelope;
}

/** A page of results plus the pagination metadata that produced it. */
export interface Page<TItem> {
  items: TItem[];
  pagination?: Pagination;
}

/**
 * Well-known `error.code` values. The list is open — always fall back to
 * rendering `error.message` for a code you do not recognise, never invent one.
 */
export const API_ERROR_CODES = [
  "validation_error",
  "authentication_failed",
  "token_expired",
  "permission_denied",
  "not_found",
  "conflict",
  "domain_rule_violation",
  "rate_limited",
  "server_error",
  "network_error",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number] | (string & {});

/** Status codes the API uses, per api-architecture.md §2.3. */
export type ApiStatusCode = 200 | 201 | 202 | 204 | 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500;

/** Long operations return `202 Accepted` + a job resource (api-architecture.md §2.7). */
export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export interface Job {
  id: string;
  status: JobStatus;
  /** 0–100 when the worker reports progress. */
  progress?: number;
  result_url?: string | null;
  error?: ApiErrorBody | null;
  created_at: string;
  updated_at: string;
}
