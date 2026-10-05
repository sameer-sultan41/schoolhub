/**
 * The auth module's domain types — re-exported here, per ADR-0019's uniform
 * five-file module shape, even though the real definitions stay in
 * `@schoolhub/types`. `AuthenticatedUser`/`LoginCredentials`/`LoginResponse` are
 * hand-authored, cross-cutting types with no generated source
 * ([ADR-0017](../../../../../docs/decisions/0017-generated-wire-types-for-new-domains.md)),
 * so `@schoolhub/types` — not this file — is their one source of truth; this is a
 * named entry point for them, not a second definition.
 */
export type { AuthenticatedUser, LoginCredentials, LoginResponse } from "@schoolhub/types";
