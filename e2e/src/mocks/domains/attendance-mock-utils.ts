import type { ApiErrorDetail, AuthenticatedUser } from "@schoolhub/types";
import { fail, type MockResponse } from "../envelope";
import type { MockRequest } from "../router";

/**
 * What the attendance stubs (`attendance-register`, `attendance-approvals`,
 * `attendance-staff-reports`, `attendance-reports-import`) share: DRF's own field messages, the
 * envelope's 400, a colon-action path segment, a multipart body's fields and the scope rule
 * record reads follow. One copy each, so a stub cannot drift from another (L5).
 */

/** DRF's own field messages, as the serializers send them. */
export const REQUIRED = "This field is required.";
export const NOT_NULL = "This field may not be null.";
export const NOT_BLANK = "This field may not be blank.";
export const INVALID_UUID = "Must be a valid UUID.";
export const INVALID_DATE = "Date has wrong format. Use one of these formats instead: YYYY-MM-DD.";
export const invalidChoice = (value: string) => `"${value}" is not a valid choice.`;

/** The shape of a date DRF's `DateField` accepts. */
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What DRF's `UUIDField` accepts (hyphenated form). */
export function isUuid(value: unknown): boolean {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * A serializer's 400, every field's error together: the message is the issue when there is
 * exactly one, and the status's code otherwise (`envelope_exception_handler`).
 */
export function fieldErrors(details: ApiErrorDetail[]): MockResponse {
  const [only] = details;
  const message = details.length === 1 && only ? only.issue : "validation_error";
  return fail(400, message, { details });
}

/** One field's 400. */
export function fieldError(field: string, issue: string): MockResponse {
  return fieldErrors([{ field, issue }]);
}

/** `{id}:{action}` from a colon-action path segment. */
export function colonAction(segment: string | undefined): {
  id: string;
  action: string | undefined;
} {
  const [id = "", action] = (segment ?? "").split(":");
  return { id, action };
}

/**
 * Any of the user's roles holds `all` or a `campus:` scope. Record reads take the broadest
 * scope (`scope_queryset`: all > campus > own > assigned), not a union; only leave's level-2
 * escalation check reads every role like a union.
 */
export function hasWideScope(user: AuthenticatedUser): boolean {
  return user.roles.some(
    (role) => role.scope === "all" || (role.scope?.startsWith("campus:") ?? false),
  );
}

/** One field of a multipart body: its text, and the file name when it is a file. */
export interface FormPart {
  value: string;
  filename: string | null;
}

/** The fields of a `multipart/form-data` body, enough for a CSV upload and its plain fields. */
export function multipartFields(request: MockRequest): Record<string, FormPart> {
  const boundary = /boundary=(?<value>[^;]+)/.exec(request.headers["content-type"] ?? "")?.groups?.[
    "value"
  ];
  const body = request.text();
  if (!boundary || !body) return {};
  const fields: Record<string, FormPart> = {};
  for (const part of body.split(`--${boundary}`).slice(1, -1)) {
    const [head = "", ...rest] = part.split("\r\n\r\n");
    const name = /name="(?<name>[^"]+)"/.exec(head)?.groups?.["name"];
    if (!name) continue;
    fields[name] = {
      value: rest.join("\r\n\r\n").replace(/\r\n$/, ""),
      filename: /filename="(?<file>[^"]*)"/.exec(head)?.groups?.["file"] ?? null,
    };
  }
  return fields;
}
