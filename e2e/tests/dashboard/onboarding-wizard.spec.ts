import { expect, test } from "@/fixtures";
import { buildUser, SCHOOL_ADMIN_PERMISSIONS, SCHOOL_SETUP_PERMISSIONS } from "@/data/factories";
import { isApiCall } from "@/lib/request-matchers";
import { onboardingModule, schoolOrganizationModule } from "@/mocks";

/**
 * The onboarding wizard (`/setup`) and the home page's "Finish setting up" card against a
 * stubbed API: the card links to the first step left, each step's own actions send the right
 * `PATCH /onboarding`, and moving between steps drops the embedded lists' URL state. Which steps
 * are done is the server's computation (`apps/platform_admin/onboarding/services.py`, tested
 * there); the stub takes it as given.
 */

const schoolAdmin = buildUser({
  permissions: [
    ...SCHOOL_ADMIN_PERMISSIONS,
    ...SCHOOL_SETUP_PERMISSIONS,
    "fees.fee-structure.create",
    "students.student.import",
  ],
});

test.describe("onboarding wizard", () => {
  test.use({ authUser: schoolAdmin });

  test.beforeEach(({ signedIn: _signedIn, mockApi }) => {
    mockApi.use(schoolOrganizationModule(), onboardingModule());
  });

  test("the home card shows the progress and opens the first step", async ({
    page,
    dashboardPage,
    setupWizardPage,
  }) => {
    await dashboardPage.goto();

    await expect(setupWizardPage.card).toBeVisible();
    await expect(page.getByText("0 of 9 steps done", { exact: true })).toBeVisible();
    await setupWizardPage.link("Continue setup").click();

    await expect(page).toHaveURL(/\/setup\?step=profile$/);
    await expect(setupWizardPage.step("School profile")).toHaveAttribute("aria-current", "step");
  });

  test("confirms the profile, then moves to the next step", async ({ page, setupWizardPage }) => {
    await setupWizardPage.openStep("profile");

    const request = page.waitForRequest((r) => isApiCall(r, "PATCH", /\/onboarding$/));
    await setupWizardPage.button("Confirm profile").click();

    expect((await request).postDataJSON()).toEqual({ confirm: "profile" });
    await expect(setupWizardPage.button("Profile confirmed")).toBeDisabled();
    await expect(setupWizardPage.step("School profile")).toContainText("Done");

    await setupWizardPage.button("Next step").click();

    await expect(page).toHaveURL(/\/setup\?step=campuses$/);
    await expect(setupWizardPage.button("Add campus")).toBeVisible();
  });

  test("skips a skippable step and takes the skip back", async ({ page, setupWizardPage }) => {
    await setupWizardPage.openStep("fee_structures");
    await expect(setupWizardPage.link("Open fee structures")).toHaveAttribute(
      "href",
      "/fees/structures",
    );

    const skip = page.waitForRequest((r) => isApiCall(r, "PATCH", /\/onboarding$/));
    await setupWizardPage.button("Skip this step").click();
    expect((await skip).postDataJSON()).toEqual({ skip: "fee_structures" });
    await expect(setupWizardPage.step("Fee structures")).toContainText("Skipped");

    const unskip = page.waitForRequest((r) => isApiCall(r, "PATCH", /\/onboarding$/));
    await setupWizardPage.button("Undo skip").click();
    expect((await unskip).postDataJSON()).toEqual({ unskip: "fee_structures" });
    await expect(setupWizardPage.step("Fee structures")).toContainText("To do");
  });

  test("opening another step drops the embedded list's URL state", async ({
    page,
    setupWizardPage,
  }) => {
    await setupWizardPage.goto({ path: "/setup?step=campuses&search=main&sort=-name" });
    await expect(setupWizardPage.button("Add campus")).toBeVisible();

    await setupWizardPage.step("Subjects").click();

    await expect(page).toHaveURL(/\/setup\?step=subjects$/);
    await expect(setupWizardPage.button("Add subject")).toBeVisible();
  });

  test("offers no Skip on a step that must be done", async ({ setupWizardPage }) => {
    await setupWizardPage.openStep("campuses");

    await expect(setupWizardPage.button("Add campus")).toBeVisible();
    await expect(setupWizardPage.button("Skip this step")).toHaveCount(0);
  });
});
