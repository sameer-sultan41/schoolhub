import type {
  CreateGuardianInput,
  LinkGuardianInput,
  UpdateGuardianLinkInput,
} from "./guardians-type";

/** The guardians module's constants — collected here so the service functions below, and
 * any future caller, share one definition instead of repeating a literal. */

/** Reference-data-sized page for a live search dropdown — not `MAX_PAGE_SIZE` (reserved
 * for a small, bounded reference list like campuses/houses): a tenant-wide guardian
 * search can realistically match far more than that, and a search dropdown only ever
 * shows a handful of results at once regardless. */
export const GUARDIAN_SEARCH_PAGE_SIZE = 20;

/** A student realistically has a handful of guardian links — large enough that no
 * student ever needs a second page, distinct from `GUARDIAN_SEARCH_PAGE_SIZE`'s
 * tenant-wide search dropdown use. */
export const GUARDIAN_LINKS_PAGE_SIZE = 50;

/** camelCase `CreateGuardianInput`/`UpdateGuardianInput` key -> the API's snake_case body
 * key. Drives `toCreateGuardianBody`/`toUpdateGuardianBody` (`guardians-helper.ts`) —
 * kept here, not inline in those functions, matching `students-constant.ts`'s
 * `STUDENT_BODY_FIELDS` convention exactly. */
export const GUARDIAN_BODY_FIELDS: ReadonlyArray<readonly [keyof CreateGuardianInput, string]> = [
  ["firstName", "first_name"],
  ["lastName", "last_name"],
  ["phone", "phone"],
  ["altPhone", "alt_phone"],
  ["email", "email"],
  ["photoFileId", "photo_file_id"],
];

/** Same convention, for `linkGuardianToStudent`'s request body (the full create-a-link
 * shape, including the guardian being linked). Kept SEPARATE from
 * `GUARDIAN_LINK_UPDATE_BODY_FIELDS` below rather than one shared list typed on the
 * union of both inputs' keys — `copyMappedFields<T>`'s field-list parameter type is
 * `keyof T`, derived from whichever single input type it's actually called with, so a
 * list typed `keyof (LinkGuardianInput & UpdateGuardianLinkInput)` (a wider key union
 * including `guardianId`, which `UpdateGuardianLinkInput` doesn't have) fails to
 * typecheck the moment it's passed where `keyof UpdateGuardianLinkInput` is expected. */
export const GUARDIAN_LINK_BODY_FIELDS: ReadonlyArray<readonly [keyof LinkGuardianInput, string]> =
  [
    ["guardianId", "guardian_id"],
    ["relationship", "relationship"],
    ["isPrimary", "is_primary"],
    ["isFeeResponsible", "is_fee_responsible"],
    ["canPickUp", "can_pick_up"],
    ["receivesCommunications", "receives_communications"],
    ["hasPortalAccess", "has_portal_access"],
  ];

/** `updateGuardianLink`'s own request body — everything in `GUARDIAN_LINK_BODY_FIELDS`
 * above EXCEPT `guardianId` (a link's own guardian is never reassigned by this call). */
export const GUARDIAN_LINK_UPDATE_BODY_FIELDS: ReadonlyArray<
  readonly [keyof UpdateGuardianLinkInput, string]
> = [
  ["relationship", "relationship"],
  ["isPrimary", "is_primary"],
  ["isFeeResponsible", "is_fee_responsible"],
  ["canPickUp", "can_pick_up"],
  ["receivesCommunications", "receives_communications"],
  ["hasPortalAccess", "has_portal_access"],
];
