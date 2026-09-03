import { env } from "@/env";
import { expect, test } from "@/fixtures";

/**
 * Live lane — requires the real stack, seeded (see `tests/live/tenant-isolation.spec.ts`'s
 * header comment for the run command).
 *
 * A stubbed `LoginPage` test can only assert that the form reacts the way its own stub was
 * told to answer — this is the one case where that's circular. These journeys prove the
 * real `LoginView` (apps/api/core/rbac/views.py) actually rejects a bad login the way the
 * form's error handling expects, which a mocked lane cannot honestly claim.
 *
 * Guest context: opts out of the shared `live-setup` session (see `live.setup.ts`) so this
 * file exercises the real, unauthenticated login form rather than reusing a cached one.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("login (real API)", () => {
  test("rejects invalid credentials with the real API's error copy", async ({
    page,
    loginPage,
  }) => {
    await loginPage.goto();
    await loginPage.signIn({
      identifier: env.LIVE_ADMIN_IDENTIFIER,
      password: "definitely-the-wrong-password",
    });

    // 401 (`ApiError.isUnauthenticated`) renders `auth.login.genericError`
    // (apps/dashboard/messages/en.json), not the API's raw "Incorrect credentials."
    // message — this proves the real 401 actually lands on that branch.
    await expect(
      loginPage.error("We could not sign you in. Check your details and try again."),
    ).toBeVisible();
    await expect(page).toHaveURL("/login");
  });
});
