import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shape — see
 * `docs/decisions/0017-generated-wire-types-for-new-domains.md`. */
export type StudentTransferRecord = ApiSchemas["StudentTransfer"];

interface RequestTransferBaseInput {
  reason: string;
  effectiveDate: string;
}

/** `fromCampusId` is always the student's own current campus — the dialog renders it
 * read-only, never a `Select` (the server does not enforce the match itself; see
 * deferred-work.md). */
export interface RequestInterCampusTransferInput extends RequestTransferBaseInput {
  transferType: "inter_campus";
  fromCampusId: string;
  toCampusId: string;
}

export interface RequestOutgoingTransferInput extends RequestTransferBaseInput {
  transferType: "outgoing";
  fromCampusId: string;
  externalSchoolName: string;
}

/** `incoming` is deliberately not a branch here — see the spec's Alternatives section. */
export type RequestTransferInput = RequestInterCampusTransferInput | RequestOutgoingTransferInput;

/** `sectionId` is required for an `inter_campus` completion only when the student
 * currently has an active enrollment to reallocate — see `complete-transfer-dialog.tsx`.
 * `complete_transfer` has no capacity-override path at all. */
export interface CompleteTransferInput {
  sectionId?: string;
}
