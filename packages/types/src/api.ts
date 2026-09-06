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
  /**
   * Total across the whole narrowed set — filters, tenant scope and record scope all
   * applied — not the page.
   *
   * Optional because counting is opt-in per endpoint server-side
   * (`CountedCursorPagination`): cursor pagination earns its cheapness by never
   * counting, so only bounded lists a person actually asks the size of turn it on.
   * An endpoint that does not count omits the key rather than sending null — absent
   * means "no total is reported here", which is a different fact from "unknown".
   */
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
  /**
   * Structured context for failures a client has to act on rather than merely
   * display — present only when the server had some, absent on ordinary
   * validation errors.
   *
   * It exists because `details` is a flat list of `{field, issue}` strings, and
   * flattening destroys anything with shape: a timetable publish refusal hands
   * back every clashing cell so the grid can highlight both sides of a double
   * booking, and as `details` that arrived as `conflicts[0].slot_ids` repeated
   * once per id, of which `fieldErrors()` keeps only the first.
   *
   * Untyped on purpose — the shape is the endpoint's, not the envelope's.
   */
  meta?: Record<string, unknown>;
}

export interface ApiErrorEnvelope {
  error: ApiErrorBody;
}

export type ApiEnvelope<TData> = ApiSuccessEnvelope<TData> | ApiErrorEnvelope;

/**
 * Narrows an arbitrary parsed response body to the error envelope shape.
 *
 * Takes `unknown`, not `ApiEnvelope<TData>`: a caller with an already-typed envelope has
 * nothing to narrow (`envelope.data`/`envelope.error` already discriminate it) — this
 * exists for the actual use case, checking a value straight out of `response.json()`,
 * which is untyped. Typing the parameter as `ApiEnvelope<TData>` made every runtime check
 * here tautological, since the type already guaranteed the shape.
 */
export function isErrorEnvelope(payload: unknown): payload is ApiErrorEnvelope {
  return typeof payload === "object" && payload !== null && "error" in payload;
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
  // Emitted by the server. Mirrors _CODE_BY_STATUS and the custom exception
  // classes in apps/api/core/api/exceptions.py; a backend test asserts the two
  // lists stay identical.
  "validation_error",
  "unauthenticated",
  "permission_denied",
  "not_found",
  "method_not_allowed",
  "conflict",
  "unprocessable",
  "domain_rule_violation",
  "rate_limited",
  "module_disabled",
  // Synthesised by this client when the request never produced an envelope.
  "network_error",
  "server_error",
  "request_failed",
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
