import { format } from "date-fns";
import { copyMappedFields, humanizeSnakeCase, stableSignedUrl } from "@/lib/helpers";
import {
  STAFF_OPTIONAL_FIELDS,
  STAFF_QUERY_FIELDS,
  STAFF_REQUIRED_LIKE_FIELDS,
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

/** A longer, absolute rendering ("January 5, 2026") — distinct from `formatLastUpdated`'s
 * relative one, used for the detail sheet's joining-date/date-of-birth fields, which read
 * better as a fixed date than "3 months ago". */
export function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : format(parsed, "PPP");
}

/**
 * camelCase `CreateStaffInput`/`UpdateStaffInput` -> the API's snake_case body.
 * `STAFF_REQUIRED_LIKE_FIELDS` is truthy-gated for both (an empty string is never
 * sent for one of these). `STAFF_OPTIONAL_FIELDS` is gated on `!== undefined` for
 * both too, so a caller can explicitly clear a nullable field with `null` on
 * *either* create or update — `createStaff` used to truthy-gate its optional fields
 * (silently dropping an explicit `null`, unlike `updateStaff`); unified so both
 * behave the same way for the same input shape.
 */
export function toStaffCreateBody(input: CreateStaffInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, STAFF_REQUIRED_LIKE_FIELDS, Boolean, body);
  copyMappedFields(input, STAFF_OPTIONAL_FIELDS, (value) => value !== undefined, body);
  return body;
}

export function toStaffUpdateBody(input: UpdateStaffInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, STAFF_REQUIRED_LIKE_FIELDS, Boolean, body);
  copyMappedFields(input, STAFF_OPTIONAL_FIELDS, (value) => value !== undefined, body);
  return body;
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
