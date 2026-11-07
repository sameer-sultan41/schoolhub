import { expect, test } from "@/fixtures";
import { buildRole, buildUser, FEES_SETUP_AUTHOR_PERMISSIONS, ORG_IDS } from "@/data/factories";
import { isApiCall } from "@/lib/request-matchers";
import {
  buildAcademicSession,
  buildCampus,
  buildFeeHead,
  buildFeeSchedule,
  buildFeeStructure,
  buildLedgerAccount,
  buildSchoolClass,
  buildTerm,
  feesSetupModule,
  type FeeStructure,
  type LedgerAccount,
  type MockApi,
  schoolOrganizationModule,
} from "@/mocks";

/**
 * Fees setup (PR A) against a stubbed API: the Structures and Fee heads tabs of `/fees/structures`,
 * a structure's page with its schedules, and the Ledger → Accounts tab. The stub (`feesSetupModule`)
 * enforces the server's rules the screens surface (L5): `:activate` refused on a structure with no
 * schedules and on a second active structure at one scope, a schedule's frequency and due rule
 * paired per field, a fee head mapped to an income account only, and a system account or one
 * with postings undeletable. Whether the server really does is the live lane's
 * (`tests/live/api/fees-setup.spec.ts`).
 */

const session = buildAcademicSession({ id: ORG_IDS.currentSession, name: "2026-27" });
const grade1 = buildSchoolClass({ id: ORG_IDS.grade1, name: "Grade 1" });
const mainCampus = buildCampus({ id: ORG_IDS.mainCampus, name: "Main Campus" });
const term1 = buildTerm({ academic_session_id: session.id, name: "Term 1" });

// The seeded `accountant`'s keys for these screens, no wider (L55).
const accountant = buildUser({
  roles: [buildRole({ slug: "accountant", name: "Accountant" })],
  permissions: FEES_SETUP_AUTHOR_PERMISSIONS,
});
// Structure-view-only: the structure view and the session read, nothing to write with.
const viewer = buildUser({
  permissions: ["fees.fee-structure.view", "school.academic-session.view"],
});

const HEADS_PATH = /\/fee-heads$/;
const STRUCTURES_PATH = /\/fee-structures$/;
const SCHEDULES_PATH = /\/fee-schedules$/;
const ACTIVATE_PATH = /\/fee-structures\/[^/]+:activate$/;

function incomeAccount(): LedgerAccount {
  return buildLedgerAccount({ code: "4001", name: "Tuition income" });
}

function stubFeesApi(
  mockApi: MockApi,
  setup: { accounts?: LedgerAccount[]; structures?: FeeStructure[]; withPostings?: string[] } = {},
) {
  const accounts = setup.accounts ?? [incomeAccount()];
  const income = accounts.find((account) => account.account_type === "income");
  const head = buildFeeHead({
    code: "TUI",
    name: "Tuition fee",
    ledger_account: income?.id ?? "",
  });
  const structures = setup.structures ?? [];
  mockApi.use(
    schoolOrganizationModule({
      academicSessions: [session],
      classes: [grade1],
      campuses: [mainCampus],
      terms: [term1],
    }),
    feesSetupModule({
      accounts,
      heads: [head],
      structures,
      accountsWithPostings: setup.withPostings ?? [],
    }),
  );
  return { head, structures };
}

test.describe("the accountant", () => {
  test.use({ authUser: accountant });

  test("creates a head, then a structure with a schedule, and activates it", async ({
    page,
    mockApi,
    feeStructuresPage,
    signedIn: _signedIn,
  }) => {
    const income = incomeAccount();
    const cash = buildLedgerAccount({
      code: "1001",
      name: "Cash",
      account_type: "asset",
      is_system: true,
    });
    stubFeesApi(mockApi, { accounts: [income, cash] });
    await feeStructuresPage.goto();

    // A fee head, mapped to an income account: the picker offers only those.
    await feeStructuresPage.tab("Fee heads").click();
    await feeStructuresPage.createHeadButton.click();
    const headDialog = feeStructuresPage.dialog("New fee head");
    await headDialog.getByLabel("Code", { exact: true }).fill("SPORT");
    await headDialog.getByLabel("Name", { exact: true }).fill("Sports fee");
    await headDialog.getByRole("combobox", { name: "Income account" }).click();
    await expect(feeStructuresPage.option("1001 Cash")).toHaveCount(0);
    await feeStructuresPage.option("4001 Tuition income").click();
    const createHead = page.waitForRequest((r) => isApiCall(r, "POST", HEADS_PATH));
    await headDialog.getByRole("button", { name: "Save", exact: true }).click();
    expect((await createHead).postDataJSON()).toMatchObject({
      code: "SPORT",
      name: "Sports fee",
      ledger_account: income.id,
    });
    await expect(headDialog).toHaveCount(0);
    await expect(feeStructuresPage.headRow("Sports fee")).toBeVisible();

    // A structure for the session and class: it opens on its own page as a draft.
    await feeStructuresPage.tab("Structures").click();
    await feeStructuresPage.createStructureButton.click();
    const structureDialog = feeStructuresPage.dialog("New fee structure");
    await structureDialog.getByLabel("Name", { exact: true }).fill("Grade 1 fees 2026");
    await structureDialog.getByRole("combobox", { name: "Session" }).click();
    await feeStructuresPage.option("2026-27").click();
    await structureDialog.getByRole("combobox", { name: "Class" }).click();
    await feeStructuresPage.option("Grade 1").click();
    const createStructure = page.waitForRequest((r) => isApiCall(r, "POST", STRUCTURES_PATH));
    await structureDialog.getByRole("button", { name: "Save", exact: true }).click();
    expect((await createStructure).postDataJSON()).toMatchObject({
      name: "Grade 1 fees 2026",
      academic_session: session.id,
      school_class: grade1.id,
      campus: null,
    });
    await expect(page).toHaveURL(/\/fees\/structures\/[0-9a-f-]{36}$/);
    await expect(feeStructuresPage.heading).toHaveText("Grade 1 fees 2026");
    await expect(feeStructuresPage.addScheduleButton).toBeVisible();

    // No schedules yet: the server refuses the activation and the confirm shows why.
    await feeStructuresPage.headerAction("Activate").click();
    const confirm = feeStructuresPage.confirmDialog;
    await confirm.getByRole("button", { name: "Activate", exact: true }).click();
    await expect(
      confirm.getByText("This structure has no fee schedules, so it would charge nothing."),
    ).toBeVisible();
    await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(confirm).toHaveCount(0);

    // A monthly schedule for the head.
    await feeStructuresPage.addScheduleButton.click();
    const scheduleDialog = feeStructuresPage.dialog("Add a fee schedule");
    await scheduleDialog.getByRole("combobox", { name: "Fee head" }).click();
    await feeStructuresPage.option("SPORT Sports fee").click();
    await scheduleDialog.getByLabel("Amount", { exact: true }).fill("1500");
    await scheduleDialog.getByRole("combobox", { name: "Frequency" }).click();
    await feeStructuresPage.option("Monthly").click();
    await scheduleDialog.getByLabel("Due day of the month").fill("10");
    const createSchedule = page.waitForRequest((r) => isApiCall(r, "POST", SCHEDULES_PATH));
    await scheduleDialog.getByRole("button", { name: "Save", exact: true }).click();
    expect((await createSchedule).postDataJSON()).toMatchObject({
      fee_head: expect.any(String),
      amount: "1500",
      frequency: "monthly",
      due_day: 10,
      due_date: null,
      term: null,
    });
    const row = feeStructuresPage.scheduleRow("SPORT Sports fee");
    await expect(row.getByText("1,500.00", { exact: true })).toBeVisible();
    await expect(row.getByText("Day 10 of each month", { exact: true })).toBeVisible();

    // Now it can be activated: it becomes fixed, and only Archive remains.
    await feeStructuresPage.headerAction("Activate").click();
    const activate = page.waitForRequest((r) => isApiCall(r, "POST", ACTIVATE_PATH));
    await feeStructuresPage.confirmDialog
      .getByRole("button", { name: "Activate", exact: true })
      .click();
    await activate;
    await expect(feeStructuresPage.headerAction("Archive")).toBeVisible();
    await expect(feeStructuresPage.headerAction("Activate")).toHaveCount(0);
    await expect(feeStructuresPage.headerAction("Edit")).toHaveCount(0);
    await expect(feeStructuresPage.addScheduleButton).toHaveCount(0);
  });

  test("is refused a second active structure for the same session, class and campus", async ({
    mockApi,
    feeStructuresPage,
    signedIn: _signedIn,
  }) => {
    const scope = { academic_session: session.id, school_class: grade1.id, campus: null };
    const draft = buildFeeStructure({
      ...scope,
      name: "Grade 1 fees (new)",
      schedules: [buildFeeSchedule()],
    });
    stubFeesApi(mockApi, {
      structures: [
        buildFeeStructure({
          ...scope,
          name: "Grade 1 fees (current)",
          status: "active",
          schedules: [buildFeeSchedule()],
        }),
        draft,
      ],
    });
    await feeStructuresPage.gotoStructure(draft.id);

    await feeStructuresPage.headerAction("Activate").click();
    const confirm = feeStructuresPage.confirmDialog;
    await confirm.getByRole("button", { name: "Activate", exact: true }).click();

    await expect(
      confirm.getByText(/'Grade 1 fees \(current\)' is already the active structure/),
    ).toBeVisible();
    // Refused, so the structure is still a draft with its Activate.
    await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(feeStructuresPage.headerAction("Activate")).toBeVisible();
  });

  test("sees a schedule's due-rule error under the field it names", async ({
    mockApi,
    feeStructuresPage,
    signedIn: _signedIn,
  }) => {
    const draft = buildFeeStructure({ academic_session: session.id, name: "Grade 1 fees" });
    stubFeesApi(mockApi, { structures: [draft] });
    await feeStructuresPage.gotoStructure(draft.id);

    await feeStructuresPage.addScheduleButton.click();
    const dialog = feeStructuresPage.dialog("Add a fee schedule");
    await dialog.getByRole("combobox", { name: "Fee head" }).click();
    await feeStructuresPage.option("TUI Tuition fee").click();
    await dialog.getByLabel("Amount", { exact: true }).fill("900");
    await dialog.getByRole("combobox", { name: "Frequency" }).click();
    await feeStructuresPage.option("Monthly").click();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();

    await expect(
      dialog.getByText("A monthly schedule needs a day-of-month due rule."),
    ).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test("is refused deleting a fee head a schedule uses, inline", async ({
    mockApi,
    feeStructuresPage,
    signedIn: _signedIn,
  }) => {
    const { head, structures } = stubFeesApi(mockApi);
    structures.push(
      buildFeeStructure({
        academic_session: session.id,
        schedules: [buildFeeSchedule({ fee_head: head.id })],
      }),
    );
    await feeStructuresPage.goto();

    await feeStructuresPage.tab("Fee heads").click();
    await feeStructuresPage.headAction("Tuition fee", "Delete").click();
    await feeStructuresPage.confirmDialog
      .getByRole("button", { name: "Delete", exact: true })
      .click();

    await expect(
      feeStructuresPage.confirmDialog.getByText(
        /referenced by a fee schedule, a fine or an invoice line/,
      ),
    ).toBeVisible();
    // The open confirm hides the page behind it from the accessibility tree: close it to read the row.
    await feeStructuresPage.confirmDialog
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(feeStructuresPage.headRow("Tuition fee")).toBeVisible();
  });
});

test.describe("the accountant's ledger", () => {
  test.use({ authUser: accountant });

  test("offers no Delete on a system account, and shows the refusal for one with postings", async ({
    mockApi,
    ledgerPage,
    signedIn: _signedIn,
  }) => {
    const cash = buildLedgerAccount({
      code: "1001",
      name: "Cash",
      account_type: "asset",
      is_system: true,
    });
    const income = incomeAccount();
    stubFeesApi(mockApi, { accounts: [income, cash], withPostings: [income.id] });
    await ledgerPage.goto();

    await expect(ledgerPage.row("Cash")).toBeVisible();
    await expect(ledgerPage.row("Cash").getByText("System account")).toBeVisible();
    await expect(ledgerPage.rowAction("Cash", "Edit")).toBeVisible();
    await expect(ledgerPage.rowAction("Cash", "Delete")).toHaveCount(0);

    await ledgerPage.rowAction("Tuition income", "Delete").click();
    await ledgerPage.confirmDialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(
      ledgerPage.confirmDialog.getByText(/has ledger postings and cannot be deleted/),
    ).toBeVisible();
    await ledgerPage.confirmDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(ledgerPage.row("Tuition income")).toBeVisible();
  });
});

test.describe("a viewer holding only the structure view key", () => {
  test.use({ authUser: viewer });

  test("reads a structure but is offered no action on it or its schedules", async ({
    mockApi,
    feeStructuresPage,
    signedIn: _signedIn,
  }) => {
    const { head, structures } = stubFeesApi(mockApi);
    const draft = buildFeeStructure({
      academic_session: session.id,
      name: "Grade 1 fees",
      schedules: [buildFeeSchedule({ fee_head: head.id })],
    });
    structures.push(draft);
    await feeStructuresPage.gotoStructure(draft.id);

    await expect(feeStructuresPage.heading).toHaveText("Grade 1 fees");
    await expect(feeStructuresPage.scheduleRow("TUI Tuition fee")).toBeVisible();
    for (const name of ["Activate", "Archive", "Edit", "Delete"] as const) {
      await expect(feeStructuresPage.headerAction(name)).toHaveCount(0);
    }
    await expect(feeStructuresPage.addScheduleButton).toHaveCount(0);
  });

  test("lists structures with no New button", async ({
    mockApi,
    feeStructuresPage,
    signedIn: _signedIn,
  }) => {
    stubFeesApi(mockApi, {
      structures: [buildFeeStructure({ academic_session: session.id, name: "Grade 1 fees" })],
    });
    await feeStructuresPage.goto();

    await expect(feeStructuresPage.structureRow("Grade 1 fees")).toBeVisible();
    await expect(feeStructuresPage.createStructureButton).toHaveCount(0);
    await feeStructuresPage.tab("Fee heads").click();
    await expect(feeStructuresPage.createHeadButton).toHaveCount(0);
  });
});
