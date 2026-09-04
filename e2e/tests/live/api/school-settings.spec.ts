import { expect, test } from "@/fixtures";

interface SchoolSettings {
  branding: unknown;
  academic: unknown;
  timezone: string;
  locale: string;
  currency: string;
}

/**
 * Live API lane — no browser, no UI. See campuses.spec.ts's header comment for the shared
 * rationale (real HTTP contract only; field validation stays at the Django unit level).
 *
 * `SchoolSettingsView` used to never bind `request.tenant` (a plain `APIView`, unlike
 * every viewset), so `RequiresModuleFeature` failed closed before ever checking the real
 * feature flag and every request 403'd regardless of a real admin's real permissions —
 * see the fix in `apps/school_organization/views.py`. This is the real journey that fix
 * unblocks, not a pinned-bug regression test.
 */
test.describe("school settings (live API)", () => {
  test("patching settings persists on a subsequent read", async ({ liveApiClient }) => {
    const before = await liveApiClient.get("/school-settings");
    expect(before.status).toBe(200);
    const original = before.data as SchoolSettings;

    // Toggle rather than hardcode a target: whichever currency seed_e2e_data leaves the
    // tenant with, this always picks a different valid ISO 4217 code to patch to.
    const nextCurrency = original.currency === "PKR" ? "USD" : "PKR";

    try {
      const patched = await liveApiClient.patch("/school-settings", { currency: nextCurrency });
      expect(patched.status).toBe(200);
      expect((patched.data as SchoolSettings).currency).toBe(nextCurrency);

      const after = await liveApiClient.get("/school-settings");
      expect(after.status).toBe(200);
      expect((after.data as SchoolSettings).currency).toBe(nextCurrency);
    } finally {
      // school-settings is a tenant-wide singleton — restore it so other live specs
      // (and reruns of this one) see the same baseline currency they started with.
      await liveApiClient
        .patch("/school-settings", { currency: original.currency })
        .catch(() => {});
    }
  });
});
