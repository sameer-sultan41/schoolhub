import type { AuthenticatedUser, PermissionKey } from "@schoolhub/types";

import { canAccessModule, hasPermission } from "../permissions";

/** A complete, minimal `AuthenticatedUser` — every field is required by the real
 * type (`packages/types/src/auth.ts`), so a partial cast here would let a genuine
 * typo in `hasPermission`'s own signature go unnoticed by `tsc`. */
function userWith(permissions: PermissionKey[]): AuthenticatedUser {
  return {
    id: "user-1",
    email: "user@example.com",
    phone: null,
    full_name: "Test User",
    avatar_url: null,
    locale: "en",
    tenant_id: "tenant-1",
    roles: [],
    permissions,
  };
}

describe("hasPermission", () => {
  it("is true when the user holds the exact key", () => {
    expect(hasPermission(userWith(["staff.staff.export"]), "staff.staff.export")).toBe(true);
  });

  it("is false when the user holds other staff keys but not this one", () => {
    const user = userWith(["staff.staff.view", "staff.staff.update"]);
    expect(hasPermission(user, "staff.staff.export")).toBe(false);
  });

  it("is false for an undefined user (still loading)", () => {
    expect(hasPermission(undefined, "staff.staff.export")).toBe(false);
  });
});

describe("canAccessModule", () => {
  it("is true when the user holds any key under the module", () => {
    const user = userWith(["staff.staff.view"]);
    expect(canAccessModule(user, "staff")).toBe(true);
  });

  it("is false when the user holds keys only for other modules", () => {
    const user = userWith(["fees.invoice.view"]);
    expect(canAccessModule(user, "staff")).toBe(false);
  });

  it("is false for an undefined user (still loading)", () => {
    expect(canAccessModule(undefined, "staff")).toBe(false);
  });
});
