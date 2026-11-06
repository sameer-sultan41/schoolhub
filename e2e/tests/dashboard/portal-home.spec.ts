import { expect, test } from "@/fixtures";
import { buildGuardianUser, buildUser } from "@/data/factories";
import {
  AYESHA,
  BILAL,
  PORTAL_IDS,
  PortalStore,
  type PortalChild,
  buildPortalChild,
  portalModule,
} from "@/mocks";

/**
 * `/portal` against a stubbed API: a guardian of two children sees a card for each and a
 * switcher that moves every tab to the other child; a module the school has off leaves its tab
 * and card out; and the audience rule sends a guardian who lands on a staff page to the portal
 * and a staff member who lands on the portal to the dashboard. The stub (`portalModule`) serves
 * the server's `PortalDashboard` shape (L5); which children a user may see, and that the cards
 * leave out drafts and unpublished results, are the Django suite's job.
 */

/** A child's card when the fees module is off: the server sends `fees: null`. */
function withoutFees(child: PortalChild): PortalChild {
  return buildPortalChild(child.student, { fees: null });
}

test.describe("a guardian of two children", () => {
  test.use({ authUser: buildGuardianUser() });

  test("the home has a card per child and the switcher moves the portal to the other child", async ({
    page,
    mockApi,
    portalPage,
    signedIn: _signedIn,
  }) => {
    mockApi.use(portalModule(new PortalStore()));
    await portalPage.goto();

    await expect(portalPage.heading).toHaveText("Your children");
    await expect(portalPage.childCard("Ayesha Khan")).toBeVisible();
    await expect(portalPage.childCard("Bilal Khan")).toBeVisible();
    await expect(portalPage.switcher).toContainText("Ayesha Khan");
    await expect(portalPage.tab("Attendance")).toHaveAttribute(
      "href",
      `/portal/${PORTAL_IDS.ayesha}/attendance`,
    );

    await portalPage.chooseChild("Bilal Khan");

    await expect(page).toHaveURL(new RegExp(`/portal/${PORTAL_IDS.bilal}$`));
    await expect(portalPage.childCard("Bilal Khan")).toBeVisible();
    await expect(portalPage.childCard("Ayesha Khan")).toHaveCount(0);
    // Bilal has no attendance marked yet, so the card says so instead of showing a blank.
    await expect(page.getByText("Not marked yet", { exact: true })).toBeVisible();
    await expect(portalPage.tab("Attendance")).toHaveAttribute(
      "href",
      `/portal/${PORTAL_IDS.bilal}/attendance`,
    );
    await expect(portalPage.tab("Fees")).toHaveAttribute(
      "href",
      `/portal/${PORTAL_IDS.bilal}/fees`,
    );
  });

  test("a module the school has off leaves its tab and its card out", async ({
    page,
    mockApi,
    portalPage,
    signedIn: _signedIn,
  }) => {
    mockApi.use(
      portalModule(
        new PortalStore({
          children: [withoutFees(AYESHA), withoutFees(BILAL)],
          modules: {
            attendance: true,
            fees: false,
            examinations: true,
            communication: true,
            timetable: true,
          },
        }),
      ),
    );
    await portalPage.goto();

    await expect(portalPage.tab("Attendance")).toBeVisible();
    await expect(portalPage.tab("Results")).toBeVisible();
    await expect(portalPage.tab("Fees")).toHaveCount(0);
    await expect(page.getByText("Fees outstanding", { exact: true })).toHaveCount(0);
    // The cards the server did send are still there.
    await expect(page.getByText("Attendance today", { exact: true })).toHaveCount(2);
  });
});

test.describe("a guardian of one child", () => {
  test.use({ authUser: buildGuardianUser() });

  test("has no switcher, and a portal with no communication module has no Messages or Notices", async ({
    mockApi,
    portalPage,
    signedIn: _signedIn,
  }) => {
    mockApi.use(
      portalModule(
        new PortalStore({
          children: [AYESHA],
          modules: {
            attendance: true,
            fees: true,
            examinations: true,
            communication: false,
            timetable: true,
          },
        }),
      ),
    );
    await portalPage.goto();

    await expect(portalPage.childCard("Ayesha Khan")).toBeVisible();
    await expect(portalPage.switcher).toHaveCount(0);
    await expect(portalPage.tab("Messages")).toHaveCount(0);
    await expect(portalPage.tab("Notices")).toHaveCount(0);
    // The inbox is the user's own mail, so it has no module flag.
    await expect(portalPage.tab("Notifications")).toBeVisible();
    await expect(portalPage.tab("Settings")).toBeVisible();
  });

  test("with no child linked says so and offers only the child-free tabs", async ({
    page,
    mockApi,
    portalPage,
    signedIn: _signedIn,
  }) => {
    mockApi.use(portalModule(new PortalStore({ children: [] })));
    await portalPage.goto();

    await expect(page.getByText("No children linked yet", { exact: true })).toBeVisible();
    await expect(portalPage.tab("Attendance")).toHaveCount(0);
    await expect(portalPage.tab("Notifications")).toBeVisible();
  });
});

test.describe("which shell a user lands in", () => {
  test.describe("as a guardian", () => {
    test.use({ authUser: buildGuardianUser() });

    test("a guardian who opens a staff page lands on the portal", async ({
      page,
      mockApi,
      portalPage,
      studentsPage,
      signedIn: _signedIn,
    }) => {
      mockApi.use(portalModule(new PortalStore()));
      await studentsPage.goto();

      await expect(page).toHaveURL("/portal");
      await expect(portalPage.heading).toHaveText("Your children");
    });
  });

  test.describe("as staff", () => {
    test.use({ authUser: buildUser({ full_name: "Imran Siddiqui" }) });

    test("a staff member who opens the portal lands on the dashboard", async ({
      page,
      mockApi,
      portalPage,
      dashboardPage,
      signedIn: _signedIn,
    }) => {
      mockApi.use(portalModule(new PortalStore()));
      await portalPage.goto();

      await expect(page).toHaveURL("/dashboard");
      await expect(dashboardPage.welcomeHeading("Imran Siddiqui")).toBeVisible();
    });
  });
});
