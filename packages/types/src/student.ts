/**
 * Student domain runtime values with no generated equivalent — the wire shape itself
 * is `ApiSchemas["Student"]`, defined in `apps/dashboard/src/services/modules/students/`
 * (see `docs/decisions/0017-generated-wire-types-for-new-domains.md`).
 */

export const GENDER_VALUES = ["male", "female", "other", "unspecified"] as const;
export type GenderValue = (typeof GENDER_VALUES)[number];

export const STUDENT_STATUS_VALUES = [
  "active",
  "suspended",
  "transferred",
  "withdrawn",
  "graduated",
] as const;
export type StudentStatus = (typeof STUDENT_STATUS_VALUES)[number];

export const RELATIONSHIP_VALUES = [
  "father",
  "mother",
  "grandparent",
  "sibling",
  "legal_guardian",
  "other",
] as const;
export type RelationshipValue = (typeof RELATIONSHIP_VALUES)[number];
