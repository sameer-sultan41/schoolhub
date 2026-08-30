import { authModule, reportingModule, tenantModule } from "@/mocks";
import { expect, test } from "@/fixtures";

const CREDENTIALS = {
  identifier: "admin@cityschool.test",
  password: "correct-horse-battery-staple",
};

test.describe("sign in", () => {
  test("sends an anonymous visitor to /login and remembers where they were going", async ({
    page,
    loginPage,
  }) => {
    await page.goto("/dashboard");

    await expect(page).toHaveURL("/login?next=%2Fdashboard");
    await expect(loginPage.identifier).toBeVisible();
  });

  test("surfaces the API's rejection without revealing which field was wrong", async ({
    mockApi,
    loginPage,
  }) => {
    mockApi.use(authModule({ credentials: CREDENTIALS, signedOut: true }));
    await loginPage.goto();

    await loginPage.signIn({ ...CREDENTIALS, password: "wrong-password" });

    // A message naming the identifier would let an attacker enumerate accounts.
    await expect(
      loginPage.error("We could not sign you in. Check your details and try again."),
    ).toBeVisible();
    await expect(loginPage.identifier).toHaveValue(CREDENTIALS.identifier);
  });

  test("blocks submission until both fields are filled", async ({ mockApi, loginPage }) => {
    mockApi.use(authModule({ credentials: CREDENTIALS, signedOut: true }));
    await loginPage.goto();

    await loginPage.submit.click();

    // Wait for the client-side validation to land before asserting the negative, or
    // the call count is read before the click has been processed.
    await expect(loginPage.identifier).toHaveAttribute("aria-invalid", "true");
    expect(mockApi.countCalls("POST", "/auth/login")).toBe(0);
  });

  test("signs in and lands on the dashboard", async ({ page, mockApi, loginPage }) => {
    mockApi.use(
      authModule({ credentials: CREDENTIALS, signedOut: true }),
      tenantModule(),
      reportingModule(),
    );
    await loginPage.goto();

    await loginPage.signIn(CREDENTIALS);

    await expect(page).toHaveURL("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("honours ?next= after a successful sign in", async ({ page, mockApi, loginPage }) => {
    mockApi.use(
      authModule({ credentials: CREDENTIALS, signedOut: true }),
      tenantModule(),
      reportingModule(),
    );
    await page.goto("/login?next=%2Fdashboard");

    await loginPage.signIn(CREDENTIALS);

    await expect(page).toHaveURL("/dashboard");
  });

  test("sends an already signed-in user away from /login", async ({
    page,
    loginPage,
    signedIn,
  }) => {
    expect(signedIn.full_name).toBeTruthy();

    await loginPage.goto();

    await expect(page).toHaveURL("/dashboard");
  });
});
