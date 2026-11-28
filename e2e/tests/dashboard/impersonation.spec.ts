import { SESSION_COOKIE_NAME } from "@/constants";
import { buildUser } from "@/data/factories";
import { dashboardTenantOrigin, env } from "@/env";
import {
  authModule,
  buildTenant,
  dashboardHomeModule,
  HANDOFF_CODE,
  impersonationModule,
  platformModule,
} from "@/mocks";
import { expect, test } from "@/fixtures";

const OPERATOR = buildUser({
  email: "ops@schoolhub.test",
  full_name: "Platform Operator",
  tenant_id: "",
  tenant_summary: null,
  roles: [],
  is_platform: true,
  mfa_enabled: true,
  permissions: ["platform.tenant.view", "platform.tenant.impersonate"],
});

const SCHOOL = buildTenant({
  id: "6f1d3c2b-8a4e-4f5d-9c7b-1a2b3c4d5e6f",
  name: "City School",
  slug: "cityschool",
  status: "active",
});

const TARGET = buildUser({ full_name: "Ayesha Rahman", email: "ayesha@cityschool.test" });

// The console runs on the bare app host; the handoff link opens the school's own host
// (`cityschool.app.localhost`), where the code becomes the session. The grant check itself (a
// released grant refused before its `exp`) is the API's, pinned in its own tests.
test.describe("impersonation", () => {
  test("an operator starts a session from the console, works in it under a banner, and ends it", async ({
    page,
    mockApi,
    impersonationPage,
  }) => {
    mockApi.use(
      authModule({ user: OPERATOR }),
      dashboardHomeModule(),
      platformModule({
        tenants: [SCHOOL],
        users: [
          {
            id: TARGET.id,
            name: TARGET.full_name,
            email: "ayesha@cityschool.test",
            roles: ["school_admin"],
          },
        ],
      }),
      impersonationModule({
        operator: OPERATOR,
        target: TARGET,
        operatorName: "Platform Operator",
      }),
    );
    await page
      .context()
      .addCookies([{ name: SESSION_COOKIE_NAME, value: "e2e-session", url: env.DASHBOARD_URL }]);

    await page.goto(`/platform/tenants/${SCHOOL.id}`);
    await impersonationPage.impersonateUser.click();

    await expect(impersonationPage.startSession).toBeDisabled();
    await impersonationPage.userPicker.click();
    await page.getByRole("option", { name: /Ayesha Rahman/ }).click();
    await impersonationPage.reason.fill("Ticket 42: the report card layout");
    await impersonationPage.startSession.click();

    // The link opens the school's dashboard in a new tab; the code rides in its fragment.
    const open = impersonationPage.openDashboard;
    await expect(open).toHaveAttribute("target", "_blank");
    const handoff = await open.getAttribute("href");
    expect(handoff).toMatch(new RegExp(`^${dashboardTenantOrigin("cityschool")}/impersonate#`));

    // Followed in this tab, where the stubs are installed, rather than in a popup.
    await page.goto(handoff ?? "");
    await expect(page).toHaveURL(`${dashboardTenantOrigin("cityschool")}/dashboard`);
    await expect(impersonationPage.banner).toContainText("Ayesha Rahman");
    await expect(impersonationPage.banner).toContainText("Platform Operator");
    // The code was spent once and is gone from the address bar.
    expect(page.url()).not.toContain(HANDOFF_CODE);
    expect(
      mockApi.calls.filter((call) => call.path === "/auth/impersonation:exchange"),
    ).toHaveLength(1);

    await impersonationPage.endSession.click();

    await expect(page).toHaveURL(`${dashboardTenantOrigin("cityschool")}/impersonate?ended=1`);
    await expect(page.getByText("This support session has ended")).toBeVisible();
    expect(mockApi.calls.filter((call) => call.path === "/auth/impersonation:end")).toHaveLength(1);
  });
});
