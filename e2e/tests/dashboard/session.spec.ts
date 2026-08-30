import { MODULE_WITHOUT_PERMISSION, buildUserWithoutPermissions } from "@/data/factories";
import { expect, test } from "@/fixtures";

test.describe("session restore", () => {
  test("exchanges the refresh cookie for an access token exactly once on a cold load", async ({
    page,
    mockApi,
    dashboardPage,
    signedIn,
  }) => {
    await dashboardPage.goto();

    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    // The access token is deliberately memory-only, so a cold load must refresh — but a
    // second refresh would mean concurrent requests are not sharing the in-flight one.
    expect(mockApi.countCalls("POST", "/auth/refresh")).toBe(1);
    expect(signedIn.permissions.length).toBeGreaterThan(0);
  });

  test("signs the user out and returns them to /login", async ({
    page,
    dashboardPage,
    signedIn: _signedIn,
  }) => {
    await dashboardPage.goto();
    await expect(dashboardPage.nav).toBeVisible();

    await dashboardPage.signOut.click();

    // The proxy routes on the session cookie, so this only passes if logout actually
    // cleared it — otherwise /login redirects straight back into the app.
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("navigation is filtered by permission", () => {
  test("shows the modules the user holds a permission for, and no others", async ({
    dashboardPage,
    signedIn,
  }) => {
    await dashboardPage.goto();

    // Granted via `students.student.view` / `staff.member.view`.
    await expect(dashboardPage.navLink("Students")).toBeVisible();
    await expect(dashboardPage.navLink("Staff")).toBeVisible();
    // No `fees.*` key, so the entry must not render at all.
    await expect(dashboardPage.navLink(MODULE_WITHOUT_PERMISSION)).toHaveCount(0);

    expect(signedIn.permissions.some((key) => key.startsWith("fees."))).toBe(false);
  });
});

test.describe("a user with no permissions", () => {
  test.use({ authUser: buildUserWithoutPermissions() });

  test("sees no module links at all", async ({ dashboardPage, signedIn: _signedIn }) => {
    await dashboardPage.goto();

    await expect(dashboardPage.nav).toBeVisible();
    // The menu is filtered client-side for usability; the API re-checks every call.
    await expect(dashboardPage.navLink("Students")).toHaveCount(0);
    await expect(dashboardPage.navLink("Staff")).toHaveCount(0);
    await expect(dashboardPage.navLink(MODULE_WITHOUT_PERMISSION)).toHaveCount(0);
  });
});
