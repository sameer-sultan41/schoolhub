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
 * test states only the field it cares about. Ids are stable rather than random — even
 * the UUID-shaped ones (`uuid`, `ORG_IDS`) — so a failing trace reads the same on every run.
 */

let sequence = 0;
/** Stable-per-run id, unique within a worker. */
export function id(prefix: string): string {
  sequence += 1;
  return `${prefix}-${String(sequence).padStart(4, "0")}`;
}

/**
 * Stable-per-run UUID-shaped id, unique within a worker, for the school-structure records
 * (campus, house, academic session, class, section) whose ids the dashboard reads back from
 * its own URL: a directory filter accepts only a UUID there and drops anything else
 * (`isUuid`, apps/dashboard/src/lib/helpers.ts). Shares `id`'s sequence, so the two never
 * collide, and is just as deterministic.
 */
export function uuid(): string {
  sequence += 1;
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

/**
 * Fixed ids for the school-structure records specs name directly. UUID-shaped for the same
 * reason as `uuid`; a different fourth group (`a000`), so they never meet a generated one.
 */
export const ORG_IDS = {
  mainCampus: "00000000-0000-4000-a000-000000000001",
  northCampus: "00000000-0000-4000-a000-000000000002",
  grade1: "00000000-0000-4000-a000-000000000011",
  sectionA: "00000000-0000-4000-a000-000000000021",
  sectionB: "00000000-0000-4000-a000-000000000022",
  currentSession: "00000000-0000-4000-a000-000000000031",
} as const;

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

/** Shared by `buildTenant` and `buildUser` so a user always belongs to the tenant on screen. */
export const DEFAULT_TENANT_ID = "tenant-e2e";

export function buildTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: DEFAULT_TENANT_ID,
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

/**
 * Permissions a school admin holds.
 *
 * `canAccessModule` shows a nav entry when the user holds *any* key prefixed with that
 * module (apps/dashboard/src/lib/permissions.ts), and `NAV_ITEMS` keys off `students`,
 * `staff`, `fees`, … — so this deliberately grants some of those modules and not others.
 * A set covering every module (or none of them) would make a filtering assertion vacuous.
 */
export const SCHOOL_ADMIN_PERMISSIONS: PermissionKey[] = [
  "school_organization.campus.view",
  "school_organization.campus.create",
  "school_organization.campus.update",
  "school_organization.class.view",
  "students.student.view",
  "staff.staff.view",
];

/** A module this user must *not* see, for the negative half of a filtering assertion. */
export const MODULE_WITHOUT_PERMISSION = "Fees & Finance";

export function buildUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: id("user"),
    email: "admin@cityschool.test",
    phone: null,
    full_name: "Ayesha Rahman",
    avatar_url: null,
    locale: "en",
    tenant_id: DEFAULT_TENANT_ID,
    roles: [buildRole()],
    permissions: SCHOOL_ADMIN_PERMISSIONS,
    ...overrides,
  };
}

/** A user with no permissions at all — for asserting the UI gates itself. */
export function buildUserWithoutPermissions(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return buildUser({
    permissions: [],
    roles: [buildRole({ slug: "guest", name: "Guest" })],
    ...overrides,
  });
}

export function buildLoginResponse(overrides: Partial<LoginResponse> = {}): LoginResponse {
  return {
    access_token: "e2e-access-token",
    expires_in: 900,
    user: buildUser(),
    ...overrides,
  };
}
