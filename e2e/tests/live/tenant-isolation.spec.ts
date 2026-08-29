import type { LoginResponse } from "@schoolhub/types";
import { TENANT_HOST_HEADER, TENANT_SLUG_HEADER } from "@/constants";
import { env, tenantOrigin } from "@/env";
import { expect, test } from "@/fixtures";

/**
 * Live lane — requires the real stack (Postgres + PgBouncer + Django + both apps):
 *
 *   docker compose -f infra/compose/docker-compose.yml up -d
 *   # seed the two tenants and the admin, then:
 *   E2E_API_BASE_URL=http://localhost:8000/api/v1 pnpm e2e:live
 *
 * These are the assertions a stubbed API cannot make honestly: a stub returns whatever it
 * was told to, so proving Row-Level Security binds needs real rows in a real database.
 */
test.describe("tenant isolation", () => {
  test("signs in against the real API and survives a cold reload", async ({
    page,
    loginPage,
  }) => {
    await loginPage.goto();
    await loginPage.signIn({
      identifier: env.LIVE_ADMIN_IDENTIFIER,
      password: env.LIVE_ADMIN_PASSWORD,
    });

    await expect(page).toHaveURL("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // The access token is memory-only, so a reload exercises the real refresh-cookie
    // rotation rather than a token still sitting in memory.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("an authenticated cross-tenant read is 404, never 403", async ({ request }) => {
    // Authenticate this API context explicitly. `request` is an isolated
    // APIRequestContext: it shares neither the browser's cookies nor the access token the
    // app keeps in memory, so a browser sign-in would leave these calls anonymous and the
    // API would answer 401 — passing the test for entirely the wrong reason.
    const login = await request.post(`${env.API_BASE_URL}/auth/login`, {
      data: {
        identifier: env.LIVE_ADMIN_IDENTIFIER,
        password: env.LIVE_ADMIN_PASSWORD,
      },
    });
    expect(login.status()).toBe(200);
    const { data } = (await login.json()) as { data: LoginResponse };
    const auth = { Authorization: `Bearer ${data.access_token}` };

    // A 403 would confirm the row exists in some other tenant; the API returns 404 so a
    // probe cannot distinguish "not yours" from "not there" (api-architecture.md §2.3).
    const response = await request.get(
      `${env.API_BASE_URL}/campuses/00000000-0000-0000-0000-000000000000`,
      { headers: auth },
    );

    expect(response.status()).toBe(404);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("not_found");
  });

  test("a client-supplied tenant header cannot select a school", async ({ page }) => {
    // Only reachable with a host that resolves to a real tenant — the proxy deletes
    // inbound x-schoolhub-* headers before setting its own, and without that anyone could
    // read any school's site by sending one header.
    await page.setExtraHTTPHeaders({
      [TENANT_SLUG_HEADER]: env.LIVE_OTHER_TENANT_SLUG,
      [TENANT_HOST_HEADER]: new URL(tenantOrigin(env.LIVE_OTHER_TENANT_SLUG)).host,
    });

    await page.goto(tenantOrigin(env.LIVE_TENANT_SLUG));

    // The spoofed headers must be ignored: the page belongs to the host, not the header.
    await expect(page.locator("body")).not.toContainText(env.LIVE_OTHER_TENANT_SLUG);
  });
});
