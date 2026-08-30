import type { AuthenticatedUser } from "@schoolhub/types";
import {
  canAccessModule,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  hasRole,
  parsePermission,
} from "./permissions";

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: "u1",
    email: "admin@cityschool.test",
    phone: null,
    full_name: "Ayesha Khan",
    avatar_url: null,
    locale: "en",
    tenant_id: "t1",
    roles: [{ id: "r1", slug: "school_admin", name: "School Admin", is_custom: false }],
    permissions: ["fees.invoice.create", "fees.invoice.view", "students.student.view"],
    ...overrides,
  };
}

describe("hasPermission", () => {
  it("matches an exact module.resource.action key", () => {
    expect(hasPermission(makeUser(), "fees.invoice.create")).toBe(true);
  });

  it("does not grant a permission the user lacks", () => {
    expect(hasPermission(makeUser(), "fees.invoice.refund")).toBe(false);
  });

  it("never grants anything without a user", () => {
    expect(hasPermission(null, "fees.invoice.view")).toBe(false);
    expect(hasPermission(undefined, "fees.invoice.view")).toBe(false);
  });

  it("does not treat a prefix as a match", () => {
    expect(
      hasPermission(makeUser({ permissions: ["fees.invoice.viewer"] }), "fees.invoice.view"),
    ).toBe(false);
  });
});

describe("permission set helpers", () => {
  it("requires every key for hasAllPermissions", () => {
    expect(hasAllPermissions(makeUser(), ["fees.invoice.create", "fees.invoice.view"])).toBe(true);
    expect(hasAllPermissions(makeUser(), ["fees.invoice.create", "fees.invoice.delete"])).toBe(
      false,
    );
  });

  it("requires only one key for hasAnyPermission", () => {
    expect(hasAnyPermission(makeUser(), ["fees.invoice.delete", "students.student.view"])).toBe(
      true,
    );
    expect(hasAnyPermission(makeUser(), ["library.book.issue"])).toBe(false);
  });

  it("detects module access from any permission in that module", () => {
    expect(canAccessModule(makeUser(), "fees")).toBe(true);
    expect(canAccessModule(makeUser(), "library")).toBe(false);
    // "fee" must not match the "fees" module.
    expect(canAccessModule(makeUser(), "fee")).toBe(false);
  });
});

describe("roles and parsing", () => {
  it("matches role slugs exactly", () => {
    expect(hasRole(makeUser(), "school_admin")).toBe(true);
    expect(hasRole(makeUser(), "teacher")).toBe(false);
  });

  it("splits a well-formed key and rejects a malformed one", () => {
    expect(parsePermission("fees.invoice.create")).toEqual({
      module: "fees",
      resource: "invoice",
      action: "create",
    });
    expect(parsePermission("fees.invoice")).toBeNull();
    expect(parsePermission("fees..create")).toBeNull();
  });
});
