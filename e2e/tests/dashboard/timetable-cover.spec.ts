import { expect, test } from "@/fixtures";
import {
  buildUser,
  ORG_IDS,
  SCHOOL_ADMIN_PERMISSIONS,
  TIMETABLE_COVER_PERMISSIONS,
  uuid,
} from "@/data/factories";
import { isApiCall } from "@/lib/request-matchers";
import {
  buildAcademicSession,
  buildEffectiveSlot,
  buildSlot,
  buildStaff,
  buildSubstitution,
  type MockApi,
  schoolOrganizationModule,
  staffModule,
  timetableCoverModule,
  timetableGridModule,
  timetableSetupModule,
} from "@/mocks";

/**
 * `/timetable/substitutions` and `/timetable/my` against a stubbed API: the cover queue's
 * decisions, a proposer withdrawing their own proposal, the propose chain, and a viewer's own
 * week with a date's cover. The stub mirrors only what the screens surface; whether the server
 * agrees is the API suite's and the live lane's job.
 */

const USER_ID = uuid();
/** A Monday in the future, so cover on it can still be cancelled. */
const COVER_DATE = "2099-01-05";
const session = buildAcademicSession({ id: ORG_IDS.currentSession, name: "2026-27" });
const amna = buildStaff({ id: uuid(), first_name: "Amna", last_name: "Raza" });
const approver = {
  ...buildUser({ permissions: [...SCHOOL_ADMIN_PERMISSIONS, ...TIMETABLE_COVER_PERMISSIONS] }),
  id: USER_ID,
};
const proposer = {
  ...buildUser({ permissions: ["timetable.timetable.view", "timetable.substitution.create"] }),
  id: USER_ID,
};

const SUBSTITUTIONS_PATH = /\/teacher-substitutions$/;
const ACTION_PATH = /\/teacher-substitutions\/[^/]+:(approve|reject|cancel)$/;

function stubCover(
  mockApi: MockApi,
  { substitutions = [buildSubstitution()], isApprover = true } = {},
) {
  const slot = buildSlot({
    staff_id: amna.id,
    staff_name: "Amna Raza",
    status: "published",
    period_name: "Period 1",
    section_name: "A",
    subject_name: "Mathematics",
  });
  mockApi.use(
    schoolOrganizationModule({ academicSessions: [session] }),
    staffModule({ staff: [amna] }),
    timetableSetupModule(),
    timetableGridModule({ slots: [slot] }),
    timetableCoverModule({
      substitutions,
      userId: USER_ID,
      isApprover,
      candidates: [{ staff_id: uuid(), staff_name: "Bilal Khan", employee_number: "E-2" }],
    }),
  );
  return slot;
}

test.describe("substitutions screen, as an approver", () => {
  test.use({ authUser: approver });

  test("approves a proposal through its confirm", async ({
    page,
    mockApi,
    timetableSubstitutionsPage,
    signedIn: _signedIn,
  }) => {
    stubCover(mockApi);
    await timetableSubstitutionsPage.goto();

    await timetableSubstitutionsPage.rowAction("Approve", "Amna Raza").click();
    const request = page.waitForRequest((r) => isApiCall(r, "POST", ACTION_PATH));
    await timetableSubstitutionsPage.confirm("Approve").click();

    expect((await request).url()).toMatch(/:approve$/);
    await expect(timetableSubstitutionsPage.row("Amna Raza")).toContainText("Confirmed");
    await expect(timetableSubstitutionsPage.rowAction("Approve", "Amna Raza")).toHaveCount(0);
  });

  test("cancels confirmed cover", async ({
    mockApi,
    timetableSubstitutionsPage,
    signedIn: _signedIn,
  }) => {
    stubCover(mockApi, { substitutions: [buildSubstitution({ status: "confirmed" })] });
    await timetableSubstitutionsPage.goto();

    await timetableSubstitutionsPage.rowAction("Cancel", "Amna Raza").click();
    await timetableSubstitutionsPage.confirm("Cancel cover").click();

    await expect(timetableSubstitutionsPage.row("Amna Raza")).toContainText("Cancelled");
    await expect(timetableSubstitutionsPage.rowAction("Cancel", "Amna Raza")).toHaveCount(0);
  });

  test("proposes cover through the date, teacher, class and colleague chain", async ({
    page,
    mockApi,
    timetableSubstitutionsPage,
    signedIn: _signedIn,
  }) => {
    const slot = stubCover(mockApi, { substitutions: [] });
    await timetableSubstitutionsPage.goto();

    await timetableSubstitutionsPage.proposeButton.click();
    await timetableSubstitutionsPage.proposeDate.fill(COVER_DATE);
    await timetableSubstitutionsPage.proposeSelect("Absent teacher").click();
    await timetableSubstitutionsPage.option("Amna Raza").click();
    await timetableSubstitutionsPage.proposeSelect("Class to cover").click();
    await timetableSubstitutionsPage.option("Period 1 · A · Mathematics").click();
    await timetableSubstitutionsPage.proposeSelect("Covering teacher").click();
    await timetableSubstitutionsPage.option("Bilal Khan").click();

    const request = page.waitForRequest((r) => isApiCall(r, "POST", SUBSTITUTIONS_PATH));
    await timetableSubstitutionsPage.proposeDialog.getByRole("button", { name: "Save" }).click();

    expect((await request).postDataJSON()).toMatchObject({
      timetable_slot_id: slot.id,
      date: COVER_DATE,
      absent_staff_id: amna.id,
      room_id: null,
      reason: null,
    });
    await expect(timetableSubstitutionsPage.proposeDialog).toBeHidden();
  });
});

test.describe("substitutions screen, as a proposer", () => {
  test.use({ authUser: proposer });

  test("withdraws their own proposal, and only theirs", async ({
    mockApi,
    timetableSubstitutionsPage,
    signedIn: _signedIn,
  }) => {
    stubCover(mockApi, {
      isApprover: false,
      substitutions: [
        buildSubstitution({ created_by: USER_ID }),
        buildSubstitution({ absent_staff_name: "Sara Malik", created_by: uuid() }),
      ],
    });
    await timetableSubstitutionsPage.goto();

    await expect(timetableSubstitutionsPage.rowAction("Approve", "Amna Raza")).toHaveCount(0);
    await expect(timetableSubstitutionsPage.rowAction("Cancel", "Sara Malik")).toHaveCount(0);

    await timetableSubstitutionsPage.rowAction("Cancel", "Amna Raza").click();
    await timetableSubstitutionsPage.confirm("Cancel cover").click();

    await expect(timetableSubstitutionsPage.row("Amna Raza")).toContainText("Cancelled");
  });
});

test.describe("my timetable", () => {
  test.use({ authUser: buildUser({ permissions: ["timetable.timetable.view"] }) });

  test("is a teacher's landing, and marks a date's cover", async ({
    page,
    mockApi,
    myTimetablePage,
    signedIn: _signedIn,
  }) => {
    mockApi.use(
      timetableCoverModule({
        myWeek: [buildEffectiveSlot({ subject_name: "Science" })],
        myWeekOn: {
          [COVER_DATE]: [
            buildEffectiveSlot({
              subject_name: "Science",
              substitution: {
                id: uuid(),
                date: COVER_DATE,
                absent_staff_id: uuid(),
                substitute_staff_id: uuid(),
                substitute_staff_name: "Bilal Khan",
                room_id: null,
                room_name: null,
                reason: null,
              },
            }),
          ],
        },
      }),
    );
    await page.goto("/timetable");

    await expect(page).toHaveURL(/\/timetable\/my$/);
    await expect(myTimetablePage.table).toContainText("Science");

    await myTimetablePage.coverDate.fill(COVER_DATE);

    await expect(myTimetablePage.table).toContainText("Covered by Bilal Khan");
  });
});
