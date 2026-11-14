import { expect, test } from "@/fixtures";
import { buildUser, ORG_IDS, SCHOOL_ADMIN_PERMISSIONS } from "@/data/factories";
import { dashboardTenantOrigin } from "@/env";
import {
  accountInvitationsModule,
  buildCampus,
  buildGuardian,
  buildGuardianLink,
  buildInvitationPreview,
  buildStudent,
  emptyAccountRequests,
  fail,
  guardiansModule,
  schoolOrganizationModule,
  studentRelationsModule,
  studentsModule,
} from "@/mocks";

/**
 * Account invitations and password reset (ADR-0033), against stubs. What the browser alone
 * decides: the link is read from the fragment and cleared, the forms send what the API
 * expects, and an unusable link explains itself. Whether a real token, a cross-tenant link
 * or an unknown email behaves is the live lane's job
 * (`tests/live/api/account-invitations.spec.ts`); the emailed journey itself is
 * backend-tested only (`dev.py` uses the console email backend).
 */

const SCHOOL = "city";
const TOKEN = "e2e-invite-token";
const UID = "e2e-uid";
const GOOD_PASSWORD = "a-long-enough-pass";

test.describe("accept an invitation", () => {
  test("sets a password from the emailed link, clearing its token, then signs in", async ({
    page,
    mockApi,
    acceptInvitePage,
  }) => {
    const received = emptyAccountRequests();
    mockApi.use(
      accountInvitationsModule({
        school: SCHOOL,
        token: TOKEN,
        preview: buildInvitationPreview({
          email: "parent@example.com",
          school_name: "City School",
        }),
        received,
      }),
    );

    await acceptInvitePage.openLink(`school=${SCHOOL}&token=${TOKEN}`);

    await expect(
      page.getByText("Choose a password for parent@example.com at City School."),
    ).toBeVisible();
    // Read once, then cleared: the token is no longer in the address bar or its history entry.
    await expect(page).toHaveURL(/\/accept-invite$/);
    expect(page.url()).not.toContain(TOKEN);

    await acceptInvitePage.accept(GOOD_PASSWORD);

    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByText("Your account is ready. Sign in with your new password."),
    ).toBeVisible();
    expect(received.accepted).toEqual([{ school: SCHOOL, token: TOKEN, password: GOOD_PASSWORD }]);
  });

  test("explains an unusable link and asks the school to resend", async ({
    page,
    mockApi,
    acceptInvitePage,
  }) => {
    mockApi.use(accountInvitationsModule({ school: SCHOOL, token: TOKEN }));

    await acceptInvitePage.openLink(`school=${SCHOOL}&token=an-expired-token`);

    await expect(acceptInvitePage.invalidLink).toBeVisible();
    await expect(page.getByText(/ask your school to resend your invitation/i)).toBeVisible();
    await expect(acceptInvitePage.newPassword).toHaveCount(0);
  });

  test("shows the server's reason for a password it refuses", async ({
    page,
    mockApi,
    acceptInvitePage,
  }) => {
    const received = emptyAccountRequests();
    mockApi.use(accountInvitationsModule({ school: SCHOOL, token: TOKEN, received }));
    await acceptInvitePage.openLink(`school=${SCHOOL}&token=${TOKEN}`);
    await expect(acceptInvitePage.newPassword).toBeVisible();

    // Long enough for the form's own rule, refused by the stub's server-side one: a
    // 10-character minimum both sides share, so this models the server's other validators.
    await acceptInvitePage.newPassword.fill("1234567890");
    await acceptInvitePage.confirmPassword.fill("1234567890");
    // Registered last, so it wins over the module's accept stub (`MockApi.on` puts it first).
    mockApi.post("/auth/invitations:invitationAction", () =>
      fail(400, "Invalid input.", {
        details: [{ field: "password", issue: "This password is entirely numeric." }],
      }),
    );
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText("This password is entirely numeric.")).toBeVisible();
    await expect(page).toHaveURL(/\/accept-invite$/);
    expect(received.accepted).toEqual([]);
  });
});

test.describe("forgot and reset password", () => {
  test("requests a reset link for the school the page is served from", async ({
    page,
    mockApi,
    forgotPasswordPage,
  }) => {
    const received = emptyAccountRequests();
    mockApi.use(accountInvitationsModule({ received }));

    // The school comes from the host, as on the sign-in form.
    await page.goto(`${dashboardTenantOrigin(SCHOOL)}${forgotPasswordPage.path}`);
    await forgotPasswordPage.requestLink("staff@example.com");

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText(/a reset link is on its way/i)).toBeVisible();
    expect(received.resetRequested).toEqual([{ school: SCHOOL, email: "staff@example.com" }]);
  });

  test("sets a new password from a reset link", async ({ page, mockApi, resetPasswordPage }) => {
    const received = emptyAccountRequests();
    mockApi.use(accountInvitationsModule({ school: SCHOOL, token: TOKEN, uid: UID, received }));

    await resetPasswordPage.openLink(`school=${SCHOOL}&uid=${UID}&token=${TOKEN}`);
    await expect(page).toHaveURL(/\/reset-password$/);
    await resetPasswordPage.reset(GOOD_PASSWORD);

    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByText("Your password has been changed. Sign in with the new one."),
    ).toBeVisible();
    expect(received.resetConfirmed).toEqual([
      { school: SCHOOL, uid: UID, token: TOKEN, new_password: GOOD_PASSWORD },
    ]);
  });

  test("offers a new link when a reset link is refused", async ({
    page,
    mockApi,
    resetPasswordPage,
  }) => {
    mockApi.use(accountInvitationsModule({ school: SCHOOL, token: TOKEN, uid: UID }));

    await resetPasswordPage.openLink(`school=${SCHOOL}&uid=${UID}&token=a-spent-token`);
    await resetPasswordPage.reset(GOOD_PASSWORD);

    await expect(resetPasswordPage.invalidLink).toBeVisible();
    await expect(page.getByRole("link", { name: "Request a new link" })).toBeVisible();
  });
});

test.describe("an admin invites a guardian", () => {
  test.use({
    authUser: buildUser({
      permissions: [
        ...SCHOOL_ADMIN_PERMISSIONS,
        "students.guardian.view",
        "students.portal-account.invite",
      ],
    }),
  });

  test("sends the invitation and shows the new portal status", async ({
    page,
    signedIn: _signedIn,
    mockApi,
    studentsPage,
    studentDetailPage,
  }) => {
    const student = buildStudent({ id: "student-0001", first_name: "Ayesha", last_name: "Khan" });
    const guardian = buildGuardian({
      id: "guardian-0001",
      first_name: "Bilal",
      last_name: "Ahmed",
      email: "bilal@example.com",
      portal_status: "none",
    });
    mockApi.use(
      schoolOrganizationModule({
        campuses: [buildCampus({ id: ORG_IDS.mainCampus, name: "Main Campus" })],
        houses: [],
      }),
      studentsModule({ students: [student] }),
      guardiansModule({
        guardians: [guardian],
        links: [
          buildGuardianLink({ student_id: student.id, guardian_id: guardian.id, is_primary: true }),
        ],
      }),
      studentRelationsModule({}),
    );

    await studentsPage.goto();
    await studentsPage.row("Ayesha Khan").click();
    await studentDetailPage.openTab("Guardians");
    const sheet = studentDetailPage.sheet;
    await expect(sheet.getByText("No account", { exact: true })).toBeVisible();

    await sheet.getByRole("button", { name: "Invite to portal — Bilal Ahmed" }).click();

    await expect(page.getByText("Invitation sent to Bilal Ahmed.")).toBeVisible();
    await expect(sheet.getByText("Invitation sent", { exact: true })).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: "Resend invitation — Bilal Ahmed" }),
    ).toBeVisible();
    expect(mockApi.countCalls("POST", "/guardians/:guardianAction")).toBe(1);
  });
});
