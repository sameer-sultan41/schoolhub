import { fail, pagedList, type MockResponse } from "./envelope";
import type { AcademicSession } from "./domains/school-organization";

/**
 * What the stateful list stubs (curriculum, teacher allocations) have in common. Not under
 * `domains/`, which is one file per API domain.
 */

/** Anything with an id and a name: the classes, subjects and campuses a created row's names
 * are looked up in. */
export interface Named {
  id: string;
  name: string;
}

export function nameOf(list: Named[], itemId: string | null | undefined): string | null {
  return list.find((item) => item.id === itemId)?.name ?? null;
}

/** Mirrors `LOCKED_SESSION_STATES` (`apps/api/apps/school_organization/services.py`). */
const LOCKED_STATUSES: readonly string[] = ["closed", "archived"];

/** 422 for a write into a closed or archived session, as `assert_session_writable` does;
 * `undefined` when the session is writable (or unknown). */
export function lockedSessionResponse(
  sessions: AcademicSession[],
  sessionId: string,
): MockResponse | undefined {
  const session = sessions.find((candidate) => candidate.id === sessionId);
  if (!session || !LOCKED_STATUSES.includes(session.status)) return undefined;
  const message = `Academic session '${session.name}' is ${session.status} and cannot be modified.`;
  return fail(422, message, {
    code: "domain_rule_violation",
    details: [{ field: "non_field", issue: message }],
  });
}

/**
 * One page of `matching`, honouring `?page=` and `?page_size=`. DRF's `PageNumberPagination`
 * answers a page past the last with 404 "Invalid page." (an empty list still has page 1), and
 * the lists recover from exactly that.
 */
export function pageOf(matching: readonly unknown[], params: URLSearchParams): MockResponse {
  const pageSize = Number(params.get("page_size") ?? matching.length) || 1;
  const page = Number(params.get("page") ?? 1) || 1;
  if (page > Math.max(1, Math.ceil(matching.length / pageSize))) {
    return fail(404, "Invalid page.");
  }
  const start = (page - 1) * pageSize;
  return pagedList(matching.slice(start, start + pageSize), {
    page,
    page_size: pageSize,
    total_count: matching.length,
  });
}

function sortKey(value: unknown): number | string {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return Number(value);
  return typeof value === "string" ? value : "";
}

/** Orders two column values: numbers (and booleans) numerically, anything else as text, with
 * a missing value sorting as the empty string. */
export function compareValues(a: unknown, b: unknown): number {
  const x = sortKey(a);
  const y = sortKey(b);
  if (typeof x === "number" && typeof y === "number") return x - y;
  return String(x).localeCompare(String(y));
}
