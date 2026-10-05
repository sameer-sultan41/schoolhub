// Re-exported, not redefined: these are cross-cutting, no-generated-source types
// (ADR-0017) whose real home is `@schoolhub/types` — consumed well beyond auth, by
// `lib/permissions.ts` and tests across students/staff.
export type { AuthenticatedUser, LoginCredentials, LoginResponse } from "@schoolhub/types";
