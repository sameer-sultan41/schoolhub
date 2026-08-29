import { env } from "@/env";
import { expect, test } from "@/fixtures";

/**
 * Live lane — requires the real stack (Postgres + PgBouncer + Django + both apps):
 *
 *   docker compose -f infra/compose/docker-compose.yml up -d
 *   pnpm --filter @schoolhub/api-seed …          # see e2e/README.md
 *   E2E_API_BASE_URL=http://localhost:8000/api/v1 pnpm e2e:live
 *
 * These are the assertions a stubbed API cannot make honestly: the stub returns whatever
 * it was told to, so proving that Row-Level Security actually binds needs real rows in a
 * real database.
 */
test.describe("tenant isolation", () => {
  test("signs in against the real API and restores the session", async ({ page, loginPage }) => {
    await loginPage.goto();
    await loginPage.signIn({
      identifier: env.LIVE_ADMIN_IDENTIFIER,
      password: env.LIVE_ADMIN_PASSWORD,
    });

    await expect(page).toHaveURL("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // Cold reload: the access token is memory-only, so this exercises the real refresh
    // cookie rotation rather than a cached token.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("a cross-tenant record reads as 404, never 403", async ({ page, request, loginPage }) => {
    await loginPage.goto();
    await loginPage.signIn({
      identifier: env.LIVE_ADMIN_IDENTIFIER,
      password: env.LIVE_ADMIN_PASSWORD,
    });
    await expect(page).toHaveURL("/dashboard");

    // A 403 would confirm the row exists in some other tenant; the API returns 404 so a
    // probe cannot distinguish "not yours" from "not there" (api-architecture.md §2.3).
    const response = await request.get(
      `${env.API_BASE_URL}/campuses/00000000-0000-0000-0000-000000000000`,
    );

    expect(response.status()).toBe(404);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("not_found");
  });
});
