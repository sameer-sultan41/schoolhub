import type { ApiErrorBody, ApiErrorDetail } from "@schoolhub/types";

/**
 * Normalized API failure. Every rejection from the client is an `ApiError` —
 * transport failures included — so callers never have to sniff error shapes.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly details: ApiErrorDetail[];
  readonly requestId: string | null;
  /**
   * Structured context the server attached to this failure, verbatim — see
   * `ApiErrorBody.meta`. Empty for every error that carried none, so a caller
   * reads it without a presence check.
   */
  readonly meta: Record<string, unknown>;
  /** HTTP status, or 0 when the request never reached the server. */
  readonly status: number;
  readonly url: string;

  constructor(init: {
    code: string;
    message: string;
    status: number;
    url: string;
    details?: ApiErrorDetail[];
    requestId?: string | null;
    meta?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "ApiError";
    this.code = init.code;
    this.status = init.status;
    this.url = init.url;
    this.details = init.details ?? [];
    this.requestId = init.requestId ?? null;
    this.meta = init.meta ?? {};
  }

  /** 401 — no valid credentials. Triggers the refresh-then-retry path once. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  /** 403 — authenticated but not permitted (cross-tenant reads return 404, never 403). */
  get isPermissionDenied(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** 400/422 — field-level validation or a domain-rule violation. */
  get isValidation(): boolean {
    return this.status === 400 || this.status === 422;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  get isServerError(): boolean {
    return this.status >= 500;
  }

  /**
   * The request failed for a reason that says nothing about the request itself:
   * it never reached the server, the server was rate-limiting, or the server
   * broke. Retrying may well succeed, and — crucially for the auth path — none of
   * these means "this session is over".
   *
   * A 4xx other than 429 is an answer, not a blip, so it is deliberately excluded.
   */
  get isTransient(): boolean {
    return this.status === 0 || this.isRateLimited || this.isServerError;
  }

  /** Field path → issue, ready to feed straight into React Hook Form's `setError`. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const detail of this.details) {
      if (detail.field && !(detail.field in out)) {
        out[detail.field] = detail.issue;
      }
    }
    return out;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Best-effort extraction of an `{ error: … }` envelope from an arbitrary payload. */
export function parseErrorEnvelope(payload: unknown): ApiErrorBody | null {
  if (!isRecord(payload) || !isRecord(payload.error)) return null;
  const error = payload.error;
  if (typeof error.code !== "string" || typeof error.message !== "string") return null;

  const details: ApiErrorDetail[] = [];
  if (Array.isArray(error.details)) {
    for (const entry of error.details) {
      if (!isRecord(entry) || typeof entry.issue !== "string") continue;
      details.push({
        issue: entry.issue,
        ...(typeof entry.field === "string" ? { field: entry.field } : {}),
        ...(typeof entry.code === "string" ? { code: entry.code } : {}),
      });
    }
  }

  return {
    code: error.code,
    message: error.message,
    details,
    request_id: typeof error.request_id === "string" ? error.request_id : "",
    // Passed through as-is: its shape belongs to the endpoint that sent it, and
    // the whole point of `meta` is that nothing between the raiser and the
    // caller reshapes it.
    ...(isRecord(error.meta) ? { meta: error.meta } : {}),
  };
}

/**
 * Fallback `error.code` for a status the server did not describe itself.
 *
 * Mirrors `_CODE_BY_STATUS` in `apps/api/core/api/exceptions.py` so a synthesised
 * code is indistinguishable from one the server sent, and callers only ever have
 * to match on a single spelling. The two 5xx values below have no server
 * counterpart: an unhandled 500 returns no envelope at all.
 */
export function codeForStatus(status: number): string {
  switch (status) {
    case 400:
      return "validation_error";
    case 401:
      return "unauthenticated";
    case 403:
      return "permission_denied";
    case 404:
      return "not_found";
    case 405:
      return "method_not_allowed";
    case 409:
      return "conflict";
    case 422:
      return "unprocessable";
    case 429:
      return "rate_limited";
    default:
      return status >= 500 ? "server_error" : "request_failed";
  }
}
