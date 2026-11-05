import type { AuthenticatedUser } from "@schoolhub/types";
import { env } from "@/env";
import { expect, test } from "@/fixtures";
import { createAnonymousLiveClient } from "@/lib/live-api";

/**
 * Live API lane — no browser. See campuses.spec.ts's header for the shared rationale.
 *
 * The emailed-link endpoints (ADR-0033) are unauthenticated and resolve the school from
 * the body's `school` slug, so what only the real stack can prove is that they leak
 * nothing: an unknown email gets the same `204` as a real one, and every unusable link —
 * a made-up token, an unknown school, or one school's account named under another school's
 * slug — is the same `400 invalid_link`.
 *
 * Not covered here: the full emailed journey (invite → email → accept → sign in). `dev.py`
 * uses the console email backend, so the live stack never reaches Mailpit; the journey is
 * backend-tested (`core/rbac/tests/`), and the Mailpit lane is in `docs/deferred-work.md`.
 *
 * Throttles: `password-reset` allows 5/hour per school+email and 20/hour per IP;
 * `invitations:*` 60/hour per IP. This file makes one reset request, two previews and one
 * confirm, well inside each.
 */

/** Django's `urlsafe_base64_encode(force_bytes(user.pk))`: unpadded base64url. */
function resetUid(userId: string): string {
  return Buffer.from(userId).toString("base64url");
}

test.describe("account links (live API)", () => {
  test("a reset request for an email with no account is a 204, like any other", async () => {
    const anonymous = createAnonymousLiveClient();
    const email = `nobody-${String(Date.now())}-${String(env.WORKER_INDEX)}@example.test`;

    const result = await anonymous.post("/auth/password-reset", {
      school: env.LIVE_TENANT_SLUG,
      email,
    });

    expect(result.status).toBe(204);
  });

  test("a made-up invitation token, or an unknown school, is 400 invalid_link", async () => {
    const anonymous = createAnonymousLiveClient();

    await expect(
      anonymous.post("/auth/invitations:preview", {
        school: env.LIVE_TENANT_SLUG,
        token: "not-a-real-invitation-token",
      }),
    ).rejects.toMatchObject({ status: 400, code: "invalid_link" });
    await expect(
      anonymous.post("/auth/invitations:preview", {
        school: "no-such-school-e2e",
        token: "not-a-real-invitation-token",
      }),
    ).rejects.toMatchObject({ status: 400, code: "invalid_link" });
  });

  test("one school's account under another school's slug is the same invalid_link", async ({
    liveApiClient,
  }) => {
    const anonymous = createAnonymousLiveClient();
    const { data: me } = await liveApiClient.get<AuthenticatedUser>("/auth/me");

    // The admin is a real, active account of LIVE_TENANT_SLUG. Under the other school's
    // slug the lookup runs in that tenant's context, where RLS hides the account, so the
    // answer must not differ from a junk link's.
    await expect(
      anonymous.post("/auth/password-reset:confirm", {
        school: env.LIVE_OTHER_TENANT_SLUG,
        uid: resetUid(me.id),
        token: "not-a-real-reset-token",
        // Any password the validators accept: the link is refused before it is checked.
        new_password: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 400, code: "invalid_link" });
  });
});
