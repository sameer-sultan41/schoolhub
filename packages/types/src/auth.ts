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

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  phone: string | null;
  full_name: string;
  avatar_url: string | null;
  locale: string;
  tenant_id: string;
  roles: Role[];
  /** Effective permission keys — the union across all roles. */
  permissions: PermissionKey[];
  /** Set when a platform support user is impersonating this account. */
  impersonated_by?: string | null;
}

export interface LoginCredentials {
  /** Email, phone, or a school-issued username (`{tenant-slug}\{admission-no}`). */
  identifier: string;
  password: string;
  /** Tenant slug. Only needed when `identifier` matches accounts at more than one school. */
  school?: string;
}

export interface LoginResponse {
  access_token: string;
  /** Seconds until `access_token` expires (15 min by default). */
  expires_in: number;
  user: AuthenticatedUser;
  /** Present when the login state machine requires a second factor. */
  second_factor_required?: boolean;
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
