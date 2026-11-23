import { env } from "@/env";
import { expect, test } from "@/fixtures";
import { createPlatformLiveSession } from "@/lib/live-platform";

interface PlatformTenant {
  id: string;
  slug: string;
  status: string;
  trial_ends_at: string | null;
  provisioned_at: string | null;
  suspended_at: string | null;
}

/**
 * Live API lane — the platform console's tenant lifecycle (platform-admin.md §7, §16).
 *
 * What only the real stack proves: a real operator, signed in with password and a real TOTP
 * code, drives one school through create → `:provision` → `:suspend` → `:reinstate`, and the
 * server's own state machine and gate answer each step. Every rule behind those steps
 * (each refused edge, the export rule, idempotent replay) is backend-tested in
 * `apps/api/apps/platform_admin/tests/`.
 *
 * Before plans exist (PR B), a school has no live subscription, so `:reinstate` needs a
 * future `trial_ends_at` and is refused without one.
 *
 * Throttles: one operator sign-in (login + `mfa:verify`) for the whole file.
 */
test.describe("platform tenants (live API)", () => {
  test("an operator provisions, suspends and reinstates a school", async ({ liveApiClient }) => {
    test.slow(true, "the TOTP sign-in may wait up to 30 s for a fresh code step");
    const platform = await createPlatformLiveSession();
    const run = `${String(Date.now())}-${String(env.WORKER_INDEX)}`;

    const { data: created, status: createdStatus } = await platform.post<PlatformTenant>(
      "/platform/tenants",
      {
        name: `E2E Platform School ${run}`,
        slug: `e2e-platform-${run}`,
        contact_name: "E2E Owner",
        contact_email: `e2e-owner-${run}@schoolhub.test`,
      },
    );
    expect(createdStatus).toBe(201);
    expect(created.status).toBe("provisioning");
    const tenantPath = `/platform/tenants/${created.id}`;

    const { data: provisioned } = await platform.post<PlatformTenant>(
      `${tenantPath}:provision`,
      {},
      { idempotencyKey: `provision-${run}` },
    );
    expect(provisioned.status).toBe("trial");
    expect(provisioned.trial_ends_at).not.toBeNull();
    expect(provisioned.provisioned_at).not.toBeNull();

    await expect(platform.post(`${tenantPath}:provision`, {})).rejects.toMatchObject({
      status: 409,
      code: "invalid_transition",
    });

    const { data: suspended } = await platform.post<PlatformTenant>(`${tenantPath}:suspend`, {
      reason: "e2e live lane",
    });
    expect(suspended.status).toBe("suspended");
    expect(suspended.suspended_at).not.toBeNull();

    await expect(platform.post(`${tenantPath}:reinstate`, {})).rejects.toMatchObject({
      status: 409,
      code: "no_live_subscription",
    });

    const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: reinstated } = await platform.post<PlatformTenant>(`${tenantPath}:reinstate`, {
      trial_ends_at: trialEndsAt,
    });
    expect(reinstated.status).toBe("trial");
    expect(reinstated.suspended_at).toBeNull();
    expect(new Date(reinstated.trial_ends_at ?? 0).getTime()).toBe(new Date(trialEndsAt).getTime());

    // A school's own token never reaches the console: 404, so the routes are not even confirmed.
    await expect(liveApiClient.get("/platform/tenants")).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
    await expect(liveApiClient.get(tenantPath)).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
  });
});
