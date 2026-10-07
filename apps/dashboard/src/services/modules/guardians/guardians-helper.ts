import { copyMappedFields } from "@/lib/helpers";
import {
  GUARDIAN_BODY_FIELDS,
  GUARDIAN_LINK_BODY_FIELDS,
  GUARDIAN_LINK_UPDATE_BODY_FIELDS,
} from "./guardians-constant";
import type { GuardianFormValues } from "./guardians.schema";
import type {
  CreateGuardianInput,
  LinkGuardianInput,
  UpdateGuardianInput,
  UpdateGuardianLinkInput,
} from "./guardians-type";

/**
 * The guardians module's pure helper functions — single source of truth, so a mapper
 * isn't reimplemented per call site. Plain data in, plain data out; no React, no API
 * calls.
 */

/** `GuardianFormValues` (snake_case, the Zod form shape) -> `CreateGuardianInput`
 * (camelCase, the service input shape), omitting an unset optional entirely. Shared by
 * `GuardianFormDialog`'s create branch (Task 5) and `GuardianPickerDialog`'s inline
 * create-tab (Task 6) — both build a brand-new guardian from the identical form. */
export function formValuesToCreateGuardianInput(values: GuardianFormValues): CreateGuardianInput {
  return {
    firstName: values.first_name,
    lastName: values.last_name,
    phone: values.phone,
    ...(values.alt_phone ? { altPhone: values.alt_phone } : {}),
    ...(values.email ? { email: values.email } : {}),
    ...(values.photo_file_id ? { photoFileId: values.photo_file_id } : {}),
  };
}

/** `GuardianFormValues` -> `UpdateGuardianInput`, for `GuardianFormDialog`'s edit save
 * (Task 5). Unlike the create mapper above, an empty `alt_phone`/`email` maps to an
 * explicit `null`, never an omitted key or a bare `""` — the form always carries a value
 * for every field (there is no "not yet provided" case once editing an existing guardian,
 * only "cleared"), so `""` has to mean "clear this field", and `toUpdateGuardianBody`'s
 * `!== undefined` gate only forwards clearing when it actually sees `null`. */
export function formValuesToUpdateGuardianInput(values: GuardianFormValues): UpdateGuardianInput {
  return {
    firstName: values.first_name,
    lastName: values.last_name,
    phone: values.phone,
    altPhone: values.alt_phone === "" ? null : values.alt_phone,
    email: values.email === "" ? null : values.email,
    ...(values.photo_file_id ? { photoFileId: values.photo_file_id } : {}),
  };
}

/** camelCase `CreateGuardianInput` -> the API's snake_case body, omitting an unset
 * optional entirely rather than sending it as empty — there is no existing guardian yet
 * for an omitted field to "leave unchanged", so there's nothing to clear. */
export function toCreateGuardianBody(input: CreateGuardianInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, GUARDIAN_BODY_FIELDS, (value) => Boolean(value), body);
  return body;
}

/** camelCase `UpdateGuardianInput` -> the API's snake_case body. Gated on `!== undefined`,
 * not truthiness: an explicit empty string (clearing `alt_phone`/`email`) must reach the
 * request body rather than being silently dropped — unlike `toCreateGuardianBody` above,
 * there IS a current value here that an omitted field would otherwise leave unchanged. */
export function toUpdateGuardianBody(input: UpdateGuardianInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, GUARDIAN_BODY_FIELDS, (value) => value !== undefined, body);
  return body;
}

export function toLinkGuardianBody(input: LinkGuardianInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  // Every `LinkGuardianInput` field is required (never `undefined`), unlike the other
  // `to*Body` helpers here — always include, rather than `value !== undefined` (which
  // `@typescript-eslint/no-unnecessary-condition` flags as always-true for this input type).
  copyMappedFields(input, GUARDIAN_LINK_BODY_FIELDS, () => true, body);
  return body;
}

export function toUpdateGuardianLinkBody(input: UpdateGuardianLinkInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, GUARDIAN_LINK_UPDATE_BODY_FIELDS, (value) => value !== undefined, body);
  return body;
}
