import { env } from "@/env";
import { expect, test } from "@/fixtures";
import { LIVE_JOB_TIMEOUT_MS } from "@/lib/live-jobs";
import { E2E_FRESH_OWNER_EMAIL } from "@/lib/seed-constants";

/**
 * Live lane — requires the real stack, seeded (`seed_e2e_data`; see
 * `tests/live/tenant-isolation.spec.ts`'s header for the run command), **on a fresh database**:
 * the journey ends by going live, which is permanent, and `fresh-school` (seeded with nothing but
 * its owner, its modules and its system ledger accounts) can be set up from nothing only once.
 * Re-running it needs the database recreated and re-seeded.
 *
 * The Phase 2 exit journey (platform-admin §5.6, school-organization §7.1): a school's owner opens
 * the home page's "Finish setting up" card and walks the wizard: profile → campus → session and
 * terms → class and section → subject → fee structure → skip staff → import three students → go
 * live, after which the card is gone. Each step's "Done" is the real server's computation from
 * the rows just written, which no mocked lane can prove. Record names carry a run tag.
 *
 * One real sign-in, then client-side navigation only (link clicks, Back), for the reason
 * `students-admission-enrollment.spec.ts`'s header gives: a full page load spends a refresh
 * against the auth throttle (e2e/AGENTS.md).
 */
test.use({ storageState: { cookies: [], origins: [] } });
// A retry would start on the half-set-up school a failure leaves and bury the real error.
test.describe.configure({ retries: 0 });

test("a new school's owner sets the school up from nothing and goes live", async ({
  page,
  loginPage,
  dashboardPage,
  setupWizardPage: wizard,
  schoolSetupPage: school,
  feeStructuresPage: fees,
  studentsPage,
}) => {
  // Three uploads' worth of job polling, plus the many screens before it.
  test.setTimeout(LIVE_JOB_TIMEOUT_MS + 240_000);
  const tag = Date.now().toString(36).slice(-5).toUpperCase();
  const campus = { name: `Campus ${tag}`, code: `C${tag}` };
  const year = new Date().getFullYear();
  const session = { name: `Year ${tag}`, start: `${year}-04-01`, end: `${year + 1}-03-31` };
  const className = `Grade ${tag}`;
  const head = { code: `H${tag}`, name: `Tuition ${tag}` };

  async function expectStepDone(title: string) {
    await expect(wizard.step(title)).toContainText("Done");
  }

  await test.step("sign in and open the wizard from the home card", async () => {
    await loginPage.goto();
    await loginPage.signIn({
      identifier: E2E_FRESH_OWNER_EMAIL,
      password: env.LIVE_ADMIN_PASSWORD,
    });
    await expect(page).toHaveURL("/dashboard");
    await expect(wizard.card).toBeVisible();
    await wizard.link("Continue setup").click();
    await expect(page).toHaveURL(/\/setup\?step=profile$/);
  });

  await test.step("confirm the profile", async () => {
    await wizard.button("Confirm profile").click();
    await expect(wizard.button("Profile confirmed")).toBeDisabled();
    await expectStepDone("School profile");
    await wizard.button("Next step").click();
  });

  await test.step("add a campus", async () => {
    await school.addButton("Add campus").click();
    await school.field("Name").fill(campus.name);
    await school.field("Code").fill(campus.code);
    await school.saveButton.click();
    await expect(school.formDialog).toBeHidden();
    await expectStepDone("Campuses");
    await wizard.button("Next step").click();
  });

  await test.step("add a session and a term that covers it", async () => {
    await school.addButton("Add session").click();
    await school.field("Name").fill(session.name);
    await school.field("Start date").fill(session.start);
    await school.field("End date").fill(session.end);
    await school.saveButton.click();
    await expect(school.formDialog).toBeHidden();

    await school.button(`Show terms for ${session.name}`).click();
    await school.addButton("Add term").click();
    await school.field("Name").fill("Term 1");
    await school.field("Start date").fill(session.start);
    await school.field("End date").fill(session.end);
    await school.saveButton.click();
    await expect(school.formDialog).toBeHidden();
    await expectStepDone("Session and terms");
    await wizard.button("Next step").click();
  });

  await test.step("add a class and its section", async () => {
    await school.addButton("Add class").click();
    await school.field("Name").fill(className);
    await school.field("Level").fill("1");
    await school.saveButton.click();
    await expect(school.formDialog).toBeHidden();

    await school.button(`Show sections for ${className}`).click();
    await school.addButton("Add section").click();
    await school.field("Name").fill("A");
    await school.formSelect("Campus").click();
    await school.option(campus.name).click();
    await school.field("Capacity").fill("30");
    await school.saveButton.click();
    await expect(school.formDialog).toBeHidden();
    await expectStepDone("Classes and sections");
    await wizard.button("Next step").click();
  });

  await test.step("add a subject", async () => {
    await school.addButton("Add subject").click();
    await school.field("Name").fill(`Mathematics ${tag}`);
    await school.field("Code").fill(`M${tag}`);
    await school.saveButton.click();
    await expect(school.formDialog).toBeHidden();
    await expectStepDone("Subjects");
    await wizard.button("Next step").click();
  });

  await test.step("set up and activate a fee structure", async () => {
    await wizard.link("Open fee structures").click();

    await fees.tab("Fee heads").click();
    await fees.createHeadButton.click();
    const headDialog = fees.dialog("New fee head");
    await headDialog.getByLabel("Code", { exact: true }).fill(head.code);
    await headDialog.getByLabel("Name", { exact: true }).fill(head.name);
    await headDialog.getByRole("combobox", { name: "Income account" }).click();
    await fees.option("4000 Fee income").click();
    await headDialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(headDialog).toHaveCount(0);

    await fees.tab("Structures").click();
    await fees.createStructureButton.click();
    const structureDialog = fees.dialog("New fee structure");
    await structureDialog.getByLabel("Name", { exact: true }).fill(`Fees ${tag}`);
    await structureDialog.getByRole("combobox", { name: "Session" }).click();
    await fees.option(session.name).click();
    await structureDialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page).toHaveURL(/\/fees\/structures\/[0-9a-f-]{36}$/);

    await fees.addScheduleButton.click();
    const scheduleDialog = fees.dialog("Add a fee schedule");
    await scheduleDialog.getByRole("combobox", { name: "Fee head" }).click();
    await fees.option(`${head.code} ${head.name}`).click();
    await scheduleDialog.getByLabel("Amount", { exact: true }).fill("1500");
    await scheduleDialog.getByRole("combobox", { name: "Frequency" }).click();
    await fees.option("Monthly").click();
    await scheduleDialog.getByLabel("Due day of the month").fill("10");
    await scheduleDialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(scheduleDialog).toHaveCount(0);

    await fees.headerAction("Activate").click();
    await fees.confirmDialog.getByRole("button", { name: "Activate", exact: true }).click();
    await expect(fees.headerAction("Archive")).toBeVisible();

    // Back through the structure list to the wizard, client-side.
    await page.goBack();
    await page.goBack();
    await expect(page).toHaveURL(/\/setup\?step=fee_structures$/);
    await expectStepDone("Fee structures");
    await wizard.button("Next step").click();
  });

  await test.step("skip staff invitations", async () => {
    await wizard.button("Skip this step").click();
    await expect(wizard.step("Invite staff")).toContainText("Skipped");
    await wizard.button("Next step").click();
  });

  await test.step("import three students", async () => {
    await wizard.link("Import students").click();
    await expect(studentsPage.importDialog).toBeVisible();
    await studentsPage.importFileInput.setInputFiles({
      name: "students.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        [
          "first_name,last_name,date_of_birth,gender,campus_code,admission_date",
          `Amna,${tag},2015-02-14,female,${campus.code},${session.start}`,
          `Bilal,${tag},2014-07-09,male,${campus.code},${session.start}`,
          `Sara,${tag},2015-11-21,female,${campus.code},${session.start}`,
        ].join("\n"),
      ),
    });
    await studentsPage.importSubmit.click();
    await expect(studentsPage.importDialog.getByText("3 imported")).toBeVisible({
      timeout: LIVE_JOB_TIMEOUT_MS,
    });
    await studentsPage.importDialog.getByRole("button", { name: "Close", exact: true }).click();

    await page.goBack();
    await expect(page).toHaveURL(/\/setup\?step=students$/);
    await expectStepDone("Import students");
  });

  await test.step("go live", async () => {
    await wizard.step("Go live").click();
    await wizard.button(`Activate ${session.name}`).click();
    await school.alertButton("Activate session").click();
    await expect(page.getByText("Your school is set up", { exact: true })).toBeVisible();
  });

  await test.step("the card is gone from the home page", async () => {
    await wizard.link("Go to the dashboard").click();
    await expect(page).toHaveURL("/dashboard");
    await expect(dashboardPage.heading).toBeVisible();
    await expect(wizard.card).toHaveCount(0);
  });
});
