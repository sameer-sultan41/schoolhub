import type { AuthenticatedUser } from "@schoolhub/types";

/** An unsigned JWT with these claims: the dashboard only reads `amr`, it never verifies. */
function jwt(claims: Record<string, unknown>): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}.signature`;
}

/** The access token `/auth/impersonation:exchange` answers (ADR-0037's claims). */
export function impersonationToken(): string {
  return jwt({
    token_type: "access",
    sub: "user-1",
    act: { sub: "operator-1" },
    grant_id: "grant-1",
    amr: ["impersonation"],
  });
}

/** A normal session's access token. */
export function schoolToken(): string {
  return jwt({ token_type: "access", sub: "user-1", amr: ["pwd"] });
}

/**
 * `/auth/me` for an impersonated session: the target, and who is acting as them until when.
 * Takes the base user (`buildUser([])`) rather than importing `@/test-utils`, which registers
 * React Testing Library's hooks: a test importing this fixture inside an `it` could not load it.
 */
export function impersonatedUser(base: AuthenticatedUser, expiresAt: string): AuthenticatedUser {
  return {
    ...base,
    full_name: "Ayesha Khan",
    impersonation: { by_name: "Support Operator", expires_at: expiresAt },
  };
}
