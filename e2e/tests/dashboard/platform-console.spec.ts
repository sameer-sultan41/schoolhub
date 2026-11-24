import { buildUser } from "@/data/factories";
import { authModule, buildTenant, dashboardHomeModule, platformModule } from "@/mocks";
import { expect, test } from "@/fixtures";

const OPERATOR_CREDENTIALS = {
  identifier: "ops@schoolhub.test",
  password: "correct-horse-battery-staple",
};

const OPERATOR = buildUser({
  email: OPERATOR_CREDENTIALS.identifier,
  full_name: "Platform Operator",
  tenant_id: "",
  tenant_summary: null,
  roles: [],
  is_platform: true,
  mfa_enabled: true,
  permissions: [
    "platform.tenant.view",
    "platform.tenant.provision",
    "platform.tenant.update",
    "platform.tenant.suspend",
    "platform.plan.view",
    "platform.subscription.view",
    "platform.feature-flag.view",
    "platform.report.view",
  ],
});

const TOTP_CODE = "246810";

// The mocked dashboard runs on the bare app host (`localhost`, PLATFORM_DOMAIN `localhost`), the
// only host the proxy serves `/platform/*` on. That a school's host 404s is pinned in the proxy's
// Jest test; that the API 404s a tenant token is the live lane's (`tests/live/api/platform-*`).
test.describe("platform console", () => {
  test("an operator signs in with a second factor, provisions a school and suspends it", async ({
    page,
    mockApi,
    loginPage,
    platformConsolePage: consolePage,
  }) => {
    mockApi.use(
      authModule({
        user: OPERATOR,
        credentials: OPERATOR_CREDENTIALS,
        signedOut: true,
        mfaCode: TOTP_CODE,
      }),
      platformModule({ tenants: [buildTenant({ name: "Existing School" })] }),
    );

    await loginPage.goto();
    await loginPage.signIn(OPERATOR_CREDENTIALS);

    // The password alone opens nothing: the challenge goes to the second-factor page.
    await expect(page).toHaveURL("/mfa/verify");

    // A wrong code is a 400: the page says so and stays, never bouncing to sign-in.
    await consolePage.mfaCode.fill("000000");
    await consolePage.mfaSubmit.click();
    await expect(page.getByRole("alert").filter({ hasText: /code isn't right/i })).toBeVisible();
    await expect(page).toHaveURL("/mfa/verify");

    await consolePage.mfaCode.fill(TOTP_CODE);
    await consolePage.mfaSubmit.click();

    // The console's landing sends the operator to the first section they may open.
    await expect(page).toHaveURL(/\/platform\/tenants/);
    await expect(consolePage.row("Existing School")).toBeVisible();

    await consolePage.newSchool.click();
    await consolePage.field("School name").fill("Lakeside School");
    await consolePage.field("Subdomain").fill("lakeside");
    await consolePage.field("Contact name").fill("Sara Malik");
    await consolePage.field("Contact email").fill("sara@lakeside.test");
    await consolePage.dialog.getByRole("button", { name: "Create school" }).click();

    await expect(consolePage.row("Lakeside School").getByText("Provisioning")).toBeVisible();

    await consolePage.row("Lakeside School").getByRole("link", { name: "Lakeside School" }).click();
    await expect(page.getByRole("heading", { name: "Lakeside School" })).toBeVisible();
    await expect(consolePage.status).toHaveText("Provisioning");

    await consolePage.action("Provision").click();
    await consolePage.dialog.getByRole("button", { name: "Provision school" }).click();
    await expect(consolePage.status).toHaveText("Trial");

    await consolePage.action("Suspend").click();
    const suspend = consolePage.dialog.getByRole("button", { name: "Suspend school" });
    await expect(suspend).toBeDisabled();
    await consolePage.dialog
      .getByRole("textbox", { name: /reason/i })
      .fill("Owner asked to pause the account");
    await suspend.click();
    await expect(consolePage.status).toHaveText("Suspended");

    // One request per action: neither dialog submitted twice.
    expect(mockApi.countCalls("POST", "/platform/tenants/:target")).toBe(2);
  });

  test("a school's staff account never sees the console in its menu", async ({
    page,
    mockApi,
    loginPage,
  }) => {
    // A school owner holds tenant-scope `platform.*` keys (files, jobs, notifications); none of
    // them is a console key.
    const owner = buildUser({
      permissions: ["platform.file.view", "platform.job.view", "platform.notification.view"],
    });
    mockApi.use(authModule({ user: owner, signedOut: true }), dashboardHomeModule());

    await loginPage.goto();
    await loginPage.signIn({
      identifier: "admin@cityschool.test",
      password: "correct-horse-battery-staple",
    });

    await expect(page).toHaveURL("/dashboard");
    await expect(page.getByRole("link", { name: "Tenants" })).toHaveCount(0);
  });
});
