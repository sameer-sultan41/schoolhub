import { z } from "zod";
import { RELATIONSHIP_VALUES } from "@schoolhub/types";

/**
 * The guardians module's Zod schemas — single source of truth for `GuardianFormDialog`
 * (Task 5, create/edit a guardian's own fields) and `GuardianPickerDialog`'s inline
 * create-tab (Task 6), so the same 5-field schema isn't redeclared in both places.
 */
export const guardianFormSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  phone: z.string().min(1),
  alt_phone: z.string().optional(),
  email: z.string().optional(),
  photo_file_id: z.string().optional(),
});

export type GuardianFormValues = z.infer<typeof guardianFormSchema>;

// `relationship` has no `.optional()`/`.default()` — the Select always has a starting
// value from the link being edited, so an empty state (and the plain-required-field
// error that would need) never happens here, unlike the picker's own relationship step
// (Task 6), which starts genuinely unset.
//
// Field names are snake_case, matching the API's own — same convention as
// `guardianFormSchema`/`studentFormSchema` (round-5 plan review: a camelCase schema here
// meant `applyServerFieldErrors`' `error.fieldErrors()` keys never matched these field
// names). `Services.guardians.updateGuardianLink` itself still takes the camelCase
// `UpdateGuardianLinkInput` (Task 2) — `toUpdateGuardianLinkInput` below bridges the two,
// the same shape as `formValuesToCreateGuardianInput` (Task 2).
//
// `has_portal_access` is deliberately NOT a field here (round-6 plan review, user
// decision 2026-10-06): spec §3.3 lists only relationship, fee-responsible, can-pick-up
// and receives-communications, and `docs/03-modules/student-management.md` §(link flags)
// flags custody/blocked-access handling through this exact field as pending client
// confirmation — exposing an edit control for it here would be building ahead of a
// decision that hasn't been made yet. The `true` default it gets at link CREATION time
// (Task 6, `LINK_FLAG_DEFAULTS`) is unaffected; only this edit dialog stays out of it.
export const linkFlagsSchema = z.object({
  relationship: z.enum(RELATIONSHIP_VALUES),
  is_fee_responsible: z.boolean(),
  can_pick_up: z.boolean(),
  receives_communications: z.boolean(),
});

export type LinkFlagsFormValues = z.infer<typeof linkFlagsSchema>;
