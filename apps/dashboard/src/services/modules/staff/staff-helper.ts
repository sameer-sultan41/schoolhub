import { copyMappedFields, humanizeSnakeCase, stableSignedUrl } from "@/lib/helpers";
import {
  STAFF_BODY_FIELDS,
  STAFF_QUERY_FIELDS,
  STATUS_META,
  type StatusVariant,
} from "./staff-constant";
import type {
  CreateStaffInput,
  StaffDirectoryQuery,
  StaffDirectoryRecord,
  StaffRow,
  UpdateStaffInput,
} from "./staff-type";

export { humanizeSnakeCase };
export { formatDate } from "@/lib/helpers";

/**
 * The staff module's pure helper functions — single source of truth, so a mapper or
 * formatter isn't reimplemented per feature file. Everything here is plain data in,
 * plain data out; no React, no API calls.
 */

/** The directory table's row shape, derived from `StaffDirectoryRecord`. */
export function toStaffRow(staff: StaffDirectoryRecord): StaffRow {
  return {
    id: staff.id,
    name: `${staff.first_name} ${staff.last_name}`,
    designation:
      staff.designation_name ??
      (staff.staff_type === "teaching" ? "Teaching staff" : "Non-teaching staff"),
    campus: staff.campus_name,
    status: staff.employment_status,
    updatedAt: staff.updated_at,
    // A refetch re-signs every link; keep the one in use so avatars don't blink.
    photoUrl: stableSignedUrl(staff.photo_url),
  };
}

export function statusMeta(status: string): { variant: StatusVariant; label: string } {
  return STATUS_META[status] ?? { variant: "secondary", label: humanizeSnakeCase(status) };
}

/**
 * camelCase `CreateStaffInput`/`UpdateStaffInput` -> the API's snake_case body, one
 * row of `STAFF_BODY_FIELDS` at a time: a `"truthy"`-gated field is never sent empty;
 * a `"defined"`-gated one is sent whenever it's not literally `undefined`, so a
 * caller can explicitly clear it with `null`. `createStaff` and `updateStaff` share
 * this one implementation — `CreateStaffInput`'s required fields are always present
 * and truthy by construction, so the same gating is correct for both callers.
 */
function toStaffBody(input: UpdateStaffInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [camelKey, snakeKey, gate] of STAFF_BODY_FIELDS) {
    const value = input[camelKey];
    const include = gate === "truthy" ? Boolean(value) : value !== undefined;
    if (include) body[snakeKey] = value;
  }
  return body;
}

export function toStaffCreateBody(input: CreateStaffInput): Record<string, unknown> {
  return toStaffBody(input);
}

export function toStaffUpdateBody(input: UpdateStaffInput): Record<string, unknown> {
  return toStaffBody(input);
}

/** `StaffDirectoryQuery` -> the `/staff` list endpoint's `?`-string params. Every
 * field, including `page`/`pageSize`, is truthy-gated — `fetchStaffPage`'s existing
 * callers rely on an unset `page`/`pageSize` being omitted (the toolbar calls it with
 * only `{ pageSize: 1 }`). */
export function toStaffQueryParams(query: StaffDirectoryQuery): Record<string, string | number> {
  const params: Record<string, unknown> = {};
  copyMappedFields(query, STAFF_QUERY_FIELDS, Boolean, params);
  return params as Record<string, string | number>;
}
