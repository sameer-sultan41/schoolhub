import type {
  AuthenticatedUser,
  LoginResponse,
  PermissionKey,
  Role,
  Tenant,
} from "@schoolhub/types";

/**
 * Deterministic builders for API-shaped test data.
 *
 * Every factory takes an overrides object and returns a complete, valid object, so a
 * test states only the field it cares about. Ids are stable strings rather than random
 * UUIDs — a failing trace should read the same on every run.
 */

let sequence = 0;
/** Stable-per-run id, unique within a worker. */
export function id(prefix: string): string {
  sequence += 1;
  return `${prefix}-${String(sequence).padStart(4, "0")}`;
}

export function buildRole(overrides: Partial<Role> = {}): Role {
  return {
    id: id("role"),
    slug: "school-admin",
    name: "School Admin",
    is_custom: false,
    scope: "all",
    ...overrides,
  };
}

export function buildTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: id("tenant"),
    slug: "cityschool",
    name: "City School",
    status: "active",
    branding: { primary_color: "oklch(0.55 0.18 264)", radius: "0.5rem" },
    locale: {
      default_locale: "en",
      enabled_locales: ["en", "ur"],
      timezone: "Asia/Karachi",
      direction: "ltr",
    },
    ...overrides,
  };
}

/** Permissions a school admin holds for the modules that exist today. */
export const SCHOOL_ADMIN_PERMISSIONS: PermissionKey[] = [
  "school_organization.campus.view",
  "school_organization.campus.create",
  "school_organization.campus.update",
  "school_organization.class.view",
  "school_organization.section.view",
  "school_organization.subject.view",
  "school_organization.academic_session.view",
];

export function buildUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: id("user"),
    email: "admin@cityschool.test",
    phone: null,
    full_name: "Ayesha Rahman",
    avatar_url: null,
    locale: "en",
    tenant_id: "tenant-0001",
    roles: [buildRole()],
    permissions: SCHOOL_ADMIN_PERMISSIONS,
    ...overrides,
  };
}

/** A user with no permissions at all — for asserting the UI gates itself. */
export function buildUserWithoutPermissions(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return buildUser({ permissions: [], roles: [buildRole({ slug: "guest", name: "Guest" })], ...overrides });
}

export function buildLoginResponse(overrides: Partial<LoginResponse> = {}): LoginResponse {
  return {
    access_token: "e2e-access-token",
    expires_in: 900,
    user: buildUser(),
    ...overrides,
  };
}
