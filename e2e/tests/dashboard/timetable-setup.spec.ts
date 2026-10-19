import { expect, test } from "@/fixtures";
import {
  buildUser,
  ORG_IDS,
  SCHOOL_ADMIN_PERMISSIONS,
  TIMETABLE_SETUP_PERMISSIONS,
} from "@/data/factories";
import { isApiCall } from "@/lib/request-matchers";
import {
  buildCampus,
  buildPeriod,
  buildRoom,
  type MockApi,
  schoolOrganizationModule,
  timetableSetupModule,
} from "@/mocks";

/**
 * The Timetable sidebar group and its two setup screens, `/timetable/periods` and
 * `/timetable/rooms`, against a stubbed API: the dialogs send the right request, the table
 * reflects the response, and the sidebar and toolbar gate on the viewer's keys. Whether the
 * server accepts a write is the API suite's job; the stub mirrors only the overlap rule the
 * period form surfaces.
 */

const campuses = [buildCampus({ id: ORG_IDS.mainCampus, name: "Main Campus" })];

const schoolAdmin = buildUser({
  permissions: [...SCHOOL_ADMIN_PERMISSIONS, ...TIMETABLE_SETUP_PERMISSIONS],
});

const PERIODS_PATH = /\/periods$/;
const ROOMS_PATH = /\/rooms$/;
const ROOM_PATH = /\/rooms\/[^/]+$/;

function stubSetupApi(mockApi: MockApi) {
  mockApi.use(
    schoolOrganizationModule({ campuses }),
    timetableSetupModule({
      campuses,
      periods: [
        buildPeriod({ name: "Period 1", sequence: 1 }),
        buildPeriod({
          name: "Recess",
          sequence: 2,
          start_time: "10:00:00",
          end_time: "10:20:00",
          is_break: true,
        }),
      ],
      rooms: [
        buildRoom({
          campus_id: ORG_IDS.mainCampus,
          campus_name: "Main Campus",
          name: "Room 101",
          code: "R-101",
        }),
      ],
    }),
  );
}

test.describe("timetable sidebar group", () => {
  test.describe("with the setup keys", () => {
    test.use({ authUser: schoolAdmin });

    test("lists Periods and Rooms under Timetable", async ({
      page,
      mockApi,
      dashboardPage,
      timetablePeriodsPage,
      signedIn: _signedIn,
    }) => {
      stubSetupApi(mockApi);
      await dashboardPage.goto();

      await dashboardPage.navGroup("Timetable").click();
      await expect(dashboardPage.navLink("Rooms")).toBeVisible();
      await dashboardPage.navLink("Periods").click();

      await expect(page).toHaveURL(/\/timetable\/periods$/);
      await expect(timetablePeriodsPage.heading).toHaveText("Periods");
    });
  });

  test.describe("with only the timetable view key", () => {
    // Every role holds `timetable.timetable.view`; it opens no setup section.
    test.use({
      authUser: buildUser({
        permissions: [...SCHOOL_ADMIN_PERMISSIONS, "timetable.timetable.view"],
      }),
    });

    test("is hidden", async ({ dashboardPage, signedIn: _signedIn }) => {
      await dashboardPage.goto();

      await expect(dashboardPage.navLink("Students")).toBeVisible();
      await expect(dashboardPage.navGroup("Timetable")).toHaveCount(0);
    });
  });
});

test.describe("periods screen", () => {
  test.use({ authUser: schoolAdmin });

  test.beforeEach(async ({ signedIn: _signedIn, mockApi, timetablePeriodsPage }) => {
    stubSetupApi(mockApi);
    await timetablePeriodsPage.goto();
    await expect(timetablePeriodsPage.row("Recess")).toBeVisible();
  });

  test("adds a period on two days", async ({ page, timetablePeriodsPage }) => {
    await timetablePeriodsPage.addButton.click();
    await timetablePeriodsPage.field("Name").fill("Period 2");
    await timetablePeriodsPage.field("Daily order").fill("3");
    await timetablePeriodsPage.field("Starts").fill("11:00");
    await timetablePeriodsPage.field("Ends").fill("11:45");
    await timetablePeriodsPage.weekday("Thursday").click();
    await timetablePeriodsPage.weekday("Monday").click();

    const request = page.waitForRequest((r) => isApiCall(r, "POST", PERIODS_PATH));
    await timetablePeriodsPage.saveButton.click();

    expect((await request).postDataJSON()).toEqual({
      campus_id: null,
      name: "Period 2",
      sequence: 3,
      start_time: "11:00",
      end_time: "11:45",
      is_break: false,
      weekdays: [0, 3],
    });
    await expect(timetablePeriodsPage.formDialog).toBeHidden();
    await expect(timetablePeriodsPage.row("Period 2")).toContainText("Mon, Thu");
  });

  test("shows the overlap under the start time and keeps the dialog open", async ({
    timetablePeriodsPage,
  }) => {
    await timetablePeriodsPage.addButton.click();
    await timetablePeriodsPage.field("Name").fill("Clash");
    await timetablePeriodsPage.field("Daily order").fill("4");
    await timetablePeriodsPage.field("Starts").fill("08:30");
    await timetablePeriodsPage.field("Ends").fill("09:00");
    await timetablePeriodsPage.saveButton.click();

    await expect(timetablePeriodsPage.formDialog).toContainText(
      "This overlaps 'Period 1' (08:00:00-08:45:00).",
    );
    await expect(timetablePeriodsPage.field("Starts")).toHaveAttribute("aria-invalid", "true");
  });

  test("removes a period", async ({ timetablePeriodsPage }) => {
    await timetablePeriodsPage.rowAction("Recess", "Remove").click();
    await timetablePeriodsPage.confirmRemove.click();

    await expect(timetablePeriodsPage.row("Recess")).toHaveCount(0);
  });
});

test.describe("rooms screen", () => {
  test.use({ authUser: schoolAdmin });

  test.beforeEach(async ({ signedIn: _signedIn, mockApi, timetableRoomsPage }) => {
    stubSetupApi(mockApi);
    await timetableRoomsPage.goto();
    await expect(timetableRoomsPage.row("Room 101")).toBeVisible();
  });

  test("takes a room out of service", async ({ page, timetableRoomsPage }) => {
    await timetableRoomsPage.rowAction("Room 101", "Edit").click();
    await timetableRoomsPage.inServiceSwitch.click();

    const request = page.waitForRequest((r) => isApiCall(r, "PATCH", ROOM_PATH));
    await timetableRoomsPage.saveButton.click();

    expect((await request).postDataJSON()).toMatchObject({ code: "R-101", is_active: false });
    await expect(timetableRoomsPage.row("Room 101")).toContainText("Out of service");
  });

  test("adds a room", async ({ page, timetableRoomsPage }) => {
    await timetableRoomsPage.addButton.click();
    await timetableRoomsPage.formSelect("Campus").click();
    await timetableRoomsPage.option("Main Campus").click();
    await timetableRoomsPage.field("Code").fill("LAB-2");
    await timetableRoomsPage.field("Name").fill("Chemistry lab");
    await timetableRoomsPage.formSelect("Room type").click();
    await timetableRoomsPage.option("Lab").click();
    await timetableRoomsPage.field("Capacity").fill("30");

    const request = page.waitForRequest((r) => isApiCall(r, "POST", ROOMS_PATH));
    await timetableRoomsPage.saveButton.click();

    expect((await request).postDataJSON()).toEqual({
      campus_id: ORG_IDS.mainCampus,
      name: "Chemistry lab",
      code: "LAB-2",
      room_type: "lab",
      capacity: 30,
      building: null,
      floor: null,
      is_active: true,
    });
    await expect(timetableRoomsPage.row("Chemistry lab")).toBeVisible();
  });

  test("removes a room", async ({ timetableRoomsPage }) => {
    await timetableRoomsPage.rowAction("Room 101", "Remove").click();
    await timetableRoomsPage.confirmRemove.click();

    await expect(timetableRoomsPage.row("Room 101")).toHaveCount(0);
  });

  test("filters to out-of-service rooms through the URL", async ({ page, timetableRoomsPage }) => {
    await timetableRoomsPage.filter("Status").click();
    await timetableRoomsPage.option("Out of service").click();

    await expect(page).toHaveURL(/status=inactive/);
    await expect(timetableRoomsPage.row("Room 101")).toHaveCount(0);
  });
});

test.describe("setup screens without the write keys", () => {
  test.use({
    authUser: buildUser({
      permissions: [
        ...SCHOOL_ADMIN_PERMISSIONS,
        "timetable.timetable.view",
        "timetable.period.update",
      ],
    }),
  });

  test("offer no Add or Remove", async ({ signedIn: _signedIn, mockApi, timetablePeriodsPage }) => {
    stubSetupApi(mockApi);
    await timetablePeriodsPage.goto();

    await expect(timetablePeriodsPage.row("Recess")).toBeVisible();
    await expect(timetablePeriodsPage.rowAction("Recess", "Edit")).toBeVisible();
    await expect(timetablePeriodsPage.rowAction("Recess", "Remove")).toHaveCount(0);
    await expect(timetablePeriodsPage.addButton).toHaveCount(0);
  });
});
