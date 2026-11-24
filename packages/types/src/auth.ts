/**
 * Auth and RBAC types — see `DOCS/docs/02-architecture/auth-and-rbac.md`.
 *
 * Permission keys are `module.resource.action` strings; roles are named sets of
 * permissions. Effective permissions are the union of every role a user holds.
 */

/**
 * A permission key: `module.resource.action`, e.g. `fees.invoice.create`.
 * The template literal type catches the obvious shape mistakes at compile time;
 * the authoritative list is code-defined on the API and seeded per release.
 */
export type PermissionKey = `${string}.${string}.${string}`;

/** Locked action vocabulary (auth-and-rbac.md §2.1) plus module-specific verbs. */
export const PERMISSION_ACTIONS = [
  "view",
  "create",
  "update",
  "delete",
  "export",
  "import",
  "approve",
  "publish",
  "mark",
  "issue",
  "collect",
  "refund",
] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/** Record-level scope attached to a `user_role` (auth-and-rbac.md §2.3). */
export type RecordScope = "own" | "assigned" | "all" | `campus:${string}`;

export interface Role {
  id: string;
  /** Slug from `DOCS/docs/00-overview/users-and-roles.md`, or a tenant custom role. */
  slug: string;
  name: string;
  is_custom: boolean;
  scope?: RecordScope;
}

/** The caller's school as `/auth/me` names it (the generated `TenantSummary` schema). */
export interface TenantSummary {
  name: string;
  /** Wildcard subdomain label. */
  slug: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  phone: string | null;
  full_name: string;
  avatar_url: string | null;
  locale: string;
  tenant_id: string;
  /** The user's school, beside its id; null for a platform user, who belongs to none. */
  tenant_summary: TenantSummary | null;
  roles: Role[];
  /** Effective permission keys — the union across all roles. */
  permissions: PermissionKey[];
  /** True for a student or guardian (the generated `User` schema's field; optional here only
   * because this hand-written type predates it, ADR-0017). */
  is_restricted_principal?: boolean;
  /** Set when a platform support user is impersonating this account. */
  impersonated_by?: string | null;
  /** A platform-scope operator, with no school (the generated `User` schema's field; optional
   * here for the same reason as `is_restricted_principal`). Routes them to the console. */
  is_platform?: boolean;
  /** TOTP is on for this account. A platform operator without it is sent to enrol. */
  mfa_enabled?: boolean;
}

export interface LoginCredentials {
  /** Email, phone, or a school-issued username (`{tenant-slug}\{admission-no}`). */
  identifier: string;
  password: string;
  /** Tenant slug. Only needed when `identifier` matches accounts at more than one school. */
  school?: string;
}

/** A completed sign-in (the generated `SignedInResponse`): `/auth/login` for an account without
 * a second factor, `/auth/mfa:verify` and `/auth/mfa:confirm` otherwise. */
export interface LoginResponse {
  access_token: string;
  /** Seconds until `access_token` expires (15 min by default). */
  expires_in: number;
  user: AuthenticatedUser;
}

/** `/auth/login`'s answer for an account with TOTP on (the generated `MfaChallengeResponse`):
 * no token and no cookie, only a short-lived signed challenge for `/auth/mfa:verify`. */
export interface MfaChallengeResponse {
  mfa_required: true;
  mfa_token: string;
}

/** What `/auth/login` returns (the generated `LoginResponse` oneOf). */
export type LoginResult = LoginResponse | MfaChallengeResponse;

export function isMfaChallenge(result: LoginResult): result is MfaChallengeResponse {
  return "mfa_required" in result && result.mfa_required;
}

export interface RefreshResponse {
  access_token: string;
  expires_in: number;
}

/** Everything the UI needs to gate itself. Never treated as enforcement. */
export interface Session {
  user: AuthenticatedUser;
  tenant_id: string;
}
