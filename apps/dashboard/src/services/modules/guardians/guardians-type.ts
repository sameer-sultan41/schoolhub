import type { ApiSchemas } from "@schoolhub/api-client";
import { RELATIONSHIP_VALUES } from "@schoolhub/types";

/** The generated wire shape — see `docs/decisions/0017-generated-wire-types-for-new-domains.md`. */
export type GuardianRecord = ApiSchemas["Guardian"];
export type GuardianLinkRecord = ApiSchemas["StudentGuardian"];
export type GuardianRelationship = GuardianLinkRecord["relationship"];

export interface CreateGuardianInput {
  firstName: string;
  lastName: string;
  phone: string;
  // `| null`, not just optional — matching `UpdateStudentInput`'s own convention
  // (`students-type.ts`) and the fix in commit 378b7e5: an explicit `null` must reach the
  // request body to clear a field, the same as `UpdateGuardianInput` below needs, rather
  // than only being distinguishable from "not provided" by an unreliable empty-string
  // sentinel. `undefined` still means "omit"; `null` means "clear/leave unset".
  altPhone?: string | null;
  email?: string | null;
  photoFileId?: string;
}

export type UpdateGuardianInput = Partial<CreateGuardianInput>;

export interface LinkGuardianInput {
  guardianId: string;
  relationship: GuardianRelationship;
  isPrimary: boolean;
  isFeeResponsible: boolean;
  canPickUp: boolean;
  receivesCommunications: boolean;
  hasPortalAccess: boolean;
}

/** Every field optional — this is always a partial update of an existing link's
 * flags/relationship, never a full replace. `isPrimary` is deliberately never set here;
 * see this plan's Global Constraints on why promotion is its own one-click action. */
export interface UpdateGuardianLinkInput {
  relationship?: GuardianRelationship;
  isFeeResponsible?: boolean;
  canPickUp?: boolean;
  receivesCommunications?: boolean;
  hasPortalAccess?: boolean;
  isPrimary?: boolean;
}

// Compile-time link, checked in BOTH directions — a one-way `satisfies` alone only
// catches a removed/renamed backend value (every RELATIONSHIP_VALUES entry must still be
// a real GuardianRelationship); it would silently miss an ADDED one, since adding a
// value only widens the union GuardianRelationship, which stays trivially assignable.
RELATIONSHIP_VALUES satisfies readonly GuardianRelationship[];

// The other direction: every GuardianRelationship must actually appear in
// RELATIONSHIP_VALUES. If the backend adds a 7th relationship value and this file isn't
// updated, this fails to compile instead of silently leaving it off the dashboard's
// `<Select>`s.
type _AssertRelationshipValuesAreExhaustive =
  GuardianRelationship extends (typeof RELATIONSHIP_VALUES)[number]
    ? true
    : [
        "RELATIONSHIP_VALUES (packages/types) is missing a value from the generated GuardianRelationship enum — add it there",
        GuardianRelationship,
      ];
const _relationshipValuesAreExhaustive: _AssertRelationshipValuesAreExhaustive = true;
// Compile-time-only check; nothing ever reads this value. `noUnusedLocals`
// (tsconfig.base.json) would otherwise reject it — same `void` pattern already used for
// exactly this reason in apps/dashboard/src/i18n/messages.types-check.ts.
void _relationshipValuesAreExhaustive;
