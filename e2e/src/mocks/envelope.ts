import type {
  ApiErrorCode,
  ApiErrorDetail,
  ApiErrorEnvelope,
  ApiMeta,
  ApiStatusCode,
  ApiSuccessEnvelope,
  CursorPagination,
} from "@schoolhub/types";

/**
 * Builders for the API response envelope (api-architecture.md §2.3–§2.4).
 *
 * Stubs go through these rather than hand-written object literals so a change to the
 * contract breaks the suite at compile time instead of producing tests that pass
 * against a shape the server no longer sends.
 */

export interface MockResponse<TBody = unknown> {
  status: ApiStatusCode;
  body: TBody;
  headers?: Record<string, string>;
}

/** `200 { data, meta }` — or any 2xx you pass. */
export function ok<TData>(
  data: TData,
  options: { status?: Extract<ApiStatusCode, 200 | 201 | 202>; meta?: ApiMeta } = {},
): MockResponse<ApiSuccessEnvelope<TData>> {
  const { status = 200, meta } = options;
  return { status, body: meta ? { data, meta } : { data } };
}

/** `204` with no body. */
export function noContent(): MockResponse<null> {
  return { status: 204, body: null };
}

/**
 * The server's status→code map, copied from `apps/api/core/api/exceptions.py`.
 * Pairing them here stops a stub from asserting a combination the API cannot emit
 * (e.g. a 403 carrying `not_found`).
 */
const CODE_BY_STATUS = {
  400: "validation_error",
  401: "unauthenticated",
  403: "permission_denied",
  404: "not_found",
  409: "conflict",
  422: "unprocessable",
  429: "rate_limited",
  500: "server_error",
} as const satisfies Partial<Record<ApiStatusCode, ApiErrorCode>>;

export type ErrorStatus = keyof typeof CODE_BY_STATUS;

/**
 * `{ error: { code, message, details, request_id } }`.
 *
 * `code` defaults to the canonical code for the status; override it only to model a
 * domain-specific code the server genuinely sends alongside that status
 * (e.g. `domain_rule_violation` on a 422).
 */
export function fail(
  status: ErrorStatus,
  message: string,
  options: { code?: ApiErrorCode; details?: ApiErrorDetail[]; requestId?: string } = {},
): MockResponse<ApiErrorEnvelope> {
  const { code = CODE_BY_STATUS[status], details, requestId = "e2e-request-id" } = options;
  return {
    status,
    body: { error: { code, message, ...(details ? { details } : {}), request_id: requestId } },
  };
}

/** A cursor-paginated list page. Cursors are opaque tokens, never URLs. */
export function paginated<TItem>(
  items: TItem[],
  pagination: Partial<CursorPagination> = {},
): MockResponse<ApiSuccessEnvelope<TItem[]>> {
  return ok(items, {
    meta: {
      pagination: {
        next_cursor: null,
        previous_cursor: null,
        page_size: items.length,
        ...pagination,
      },
    },
  });
}
