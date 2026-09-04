import { buildLiveCampus } from "@/data/live-factories";
import { env } from "@/env";
import { expect, test } from "@/fixtures";
import { runCrudLifecycle } from "@/lib/live-crud-lifecycle";
import { E2E_OTHER_ADMIN_EMAIL } from "@/lib/seed-constants";

interface Campus {
  id: string;
  name: string;
  code: string;
}

/**
 * Live API lane — no browser, no UI (the dashboard has no screen for this module yet).
 * Real HTTP against the real Django API, authenticated once per worker (`liveApiClient`,
 * see `@/lib/live-api`).
 *
 * Proves the real HTTP contract and cross-cutting behavior (envelope shape, real database
 * constraints, RLS) end-to-end — field-level validation is already exhaustively covered at
 * the Django level (`apps/api/apps/school_organization/tests/test_api.py`), so it is not
 * repeated here.
 */
test.describe("campuses (live API)", () => {
  test("supports the full create/read/update/delete lifecycle", async ({ liveApiClient }) => {
    await runCrudLifecycle<Campus>({
      liveApiClient,
      endpoint: "/campuses",
      build: buildLiveCampus,
      patch: { name: "Renamed" },
      assertCreated: (campus) => {
        expect(campus.code).toBeTruthy();
      },
      assertListed: (listed) => {
        expect(listed.meta?.pagination).toBeDefined();
      },
      assertPatched: (campus) => {
        expect(campus.name).toBe("Renamed");
      },
    });
  });

  // The one resource file that repeats the tenant-isolation probe (already proven with a
  // placeholder id in tests/live/tenant-isolation.spec.ts): RLS is one shared mechanism
  // (TenantScopedViewSetMixin + the database policy), and
  // apps/api/apps/school_organization/tests/test_cross_tenant.py already exhaustively
  // proves it per-model at the Django level — repeating it in all nine resource files
  // here would prove the same thing nine times over. This version uses a real row and a
  // real second identity: seed_e2e_data seeds a *distinct* admin email on the other
  // tenant (not the same email disambiguated by `school` — two accounts sharing one
  // email across tenants makes every browser-driven live-lane login ambiguous, since the
  // dashboard's login form never sends `school`), so this logs in as a genuine second
  // identity rather than reusing the first tenant's own session against an id it never owned.
  test("a real campus is 404 to another tenant's admin, never 403", async ({ liveApiClient }) => {
    const created = await liveApiClient.post("/campuses", buildLiveCampus());
    const campus = created.data as { id: string };

    try {
      const otherTenantLogin = await fetch(`${env.API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: E2E_OTHER_ADMIN_EMAIL,
          password: env.LIVE_ADMIN_PASSWORD,
        }),
      });
      expect(otherTenantLogin.status).toBe(200);
      const { data: otherLogin } = (await otherTenantLogin.json()) as {
        data: { access_token: string };
      };

      const probe = await fetch(`${env.API_BASE_URL}/campuses/${campus.id}`, {
        headers: { Authorization: `Bearer ${otherLogin.access_token}` },
      });
      expect(probe.status).toBe(404);
      const body = (await probe.json()) as { error?: { code?: string } };
      expect(body.error?.code).toBe("not_found");
    } finally {
      await liveApiClient.delete(`/campuses/${campus.id}`).catch(() => {});
    }
  });
});
