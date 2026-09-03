import { expect, test } from "@/fixtures";

/**
 * Live API lane — no browser, no UI. See campuses.spec.ts's header comment for the shared
 * rationale (real HTTP contract only; field validation stays at the Django unit level).
 *
 * A genuine tenant-wide singleton, not a per-test resource: restores the original values
 * in `finally` so this test's outcome does not depend on run order the next time it runs
 * against the same persistent dev database — required by this suite's own
 * every-spec-is-independent rule (e2e/AGENTS.md) the moment two runs happen without a
 * database reset in between.
 */
test.describe("school settings (live API)", () => {
  test("gets, patches, and persists the singleton", async ({ liveApiClient }) => {
    const original = await liveApiClient.get("/school-settings");
    expect(original.status).toBe(200);
    const originalTimezone = (original.data as { timezone: string }).timezone;

    const replacementTimezone = originalTimezone === "Asia/Karachi" ? "Asia/Dubai" : "Asia/Karachi";

    try {
      const patched = await liveApiClient.patch("/school-settings", {
        timezone: replacementTimezone,
      });
      expect(patched.status).toBe(200);
      expect((patched.data as { timezone: string }).timezone).toBe(replacementTimezone);

      const refetched = await liveApiClient.get("/school-settings");
      expect((refetched.data as { timezone: string }).timezone).toBe(replacementTimezone);
    } finally {
      await liveApiClient.patch("/school-settings", { timezone: originalTimezone }).catch(() => {
        // Best-effort restoration; a failure here must not mask the test's own result.
      });
    }
  });
});
