import { expect, test } from "@/fixtures";
import { buildUser, SCHOOL_ADMIN_PERMISSIONS } from "@/data/factories";
import { buildCampus, schoolOrganizationModule } from "@/mocks";
import { buildStudent, studentsModule } from "@/mocks";
import { buildGuardian, buildGuardianLink, guardiansModule } from "@/mocks";
import { buildEmergencyContact, buildStudentDocument, studentRelationsModule } from "@/mocks";
import { filesModule, jobsModule } from "@/mocks";

const UPLOAD_URL = "https://files.example.test/upload-target";

const campuses = [buildCampus({ id: "campus-0001", name: "Main Campus" })];
const student = buildStudent({ id: "student-0001", first_name: "Ayesha", last_name: "Khan" });

test.describe("student detail sheet — relations tabs", () => {
  test.use({
    authUser: buildUser({
      permissions: [
        ...SCHOOL_ADMIN_PERMISSIONS,
        // `SCHOOL_ADMIN_PERMISSIONS` (e2e/src/data/factories.ts) holds
        // `students.student.view` but not `.update` — confirmed by reading the file
        // directly, not assumed. The emergency-contact Add button is gated on `.update`
        // (Task 10), so it must be granted explicitly here.
        "students.student.update",
        "students.guardian.view",
        "students.guardian.create",
        "students.guardian.update",
        "students.document.view",
        "students.document.create",
        "students.document.verify",
        "students.document.delete",
      ],
    }),
  });

  test("links an existing guardian found by search", async ({
    page,
    signedIn: _signedIn,
    mockApi,
    studentsPage,
  }) => {
    const guardian = buildGuardian({
      id: "guardian-0001",
      first_name: "Bilal",
      last_name: "Ahmed",
    });
    mockApi.use(
      schoolOrganizationModule({ campuses, houses: [] }),
      studentsModule({ students: [student] }),
      guardiansModule({ guardians: [guardian] }),
      studentRelationsModule({}),
    );
    await studentsPage.goto();
    await studentsPage.row("Ayesha Khan").click();
    await page.getByRole("tab", { name: /^guardians$/i }).click();
    await page.getByRole("button", { name: /link guardian/i }).click();

    await page.getByLabel(/search by name or phone/i).fill("Bilal");
    // The results Select renders its options only once opened — same reason the Jest
    // tests (Task 6) open this trigger before clicking an option.
    await page.getByRole("combobox", { name: /search existing/i }).click();
    await page.getByRole("option", { name: /bilal ahmed/i }).click();
    await page.getByRole("combobox", { name: /relationship/i }).click();
    await page.getByRole("option", { name: /^father$/i }).click();
    // Scoped to the open dialog: the tab's own "Link guardian" trigger button (which
    // opened this dialog) stays mounted behind it and shares this exact text, so an
    // unscoped query here would match two elements.
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^link guardian$/i })
      .click();

    await expect(page.getByText("Bilal Ahmed")).toBeVisible();
  });

  test("promotes a guardian to primary", async ({
    page,
    signedIn: _signedIn,
    mockApi,
    studentsPage,
  }) => {
    const guardian = buildGuardian({
      id: "guardian-0001",
      first_name: "Bilal",
      last_name: "Ahmed",
    });
    const link = buildGuardianLink({
      id: "link-0001",
      student_id: "student-0001",
      guardian_id: "guardian-0001",
      is_primary: false,
    });
    mockApi.use(
      schoolOrganizationModule({ campuses, houses: [] }),
      studentsModule({ students: [student] }),
      guardiansModule({ guardians: [guardian], links: [link] }),
      studentRelationsModule({}),
    );
    await studentsPage.goto();
    await studentsPage.row("Ayesha Khan").click();
    await page.getByRole("tab", { name: /^guardians$/i }).click();
    await page.getByRole("button", { name: /make primary/i }).click();

    await expect(page.getByText(/^primary$/i)).toBeVisible();
  });

  test("adds an emergency contact", async ({
    page,
    signedIn: _signedIn,
    mockApi,
    studentsPage,
  }) => {
    mockApi.use(
      schoolOrganizationModule({ campuses, houses: [] }),
      studentsModule({ students: [student] }),
      guardiansModule({}),
      studentRelationsModule({}),
    );
    await studentsPage.goto();
    await studentsPage.row("Ayesha Khan").click();
    await page.getByRole("tab", { name: /emergency contacts/i }).click();
    await page.getByRole("button", { name: /add contact/i }).click();

    await page.getByLabel(/^name$/i).fill("Zainab Malik");
    await page.getByLabel(/relationship/i).fill("Aunt");
    await page.getByLabel(/^phone$/i).fill("0300-3333333");
    // Scoped to the open dialog: the tab's own "Add contact" trigger button stays
    // mounted behind it and shares this exact text.
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^add contact$/i })
      .click();

    await expect(page.getByText("Zainab Malik")).toBeVisible();
  });

  test("uploads a document, then verifies it", async ({
    page,
    signedIn: _signedIn,
    mockApi,
    studentsPage,
  }) => {
    mockApi.use(
      schoolOrganizationModule({ campuses, houses: [] }),
      studentsModule({ students: [student] }),
      guardiansModule({}),
      studentRelationsModule({}),
      filesModule({ uploadUrl: UPLOAD_URL }),
      jobsModule({}),
    );
    // `files-service.ts`'s PUT-to-storage step is a plain `fetch` straight to the
    // presigned URL, never through `apiClient` — `mockApi` only intercepts this app's
    // own API origin, so the storage PUT needs its own route. `UPLOAD_URL` is a
    // different origin than the app itself, and a PUT with a non-form `Content-Type`
    // (a real image/PDF mime type isn't CORS-"simple") makes the browser send an
    // `OPTIONS` preflight to this same URL first — fulfilling only the PUT, with no
    // CORS headers on either response, makes the browser's own CORS check fail before
    // the real PUT is ever sent, regardless of what this route returns for it.
    await page.route(UPLOAD_URL, (route) => {
      const corsHeaders = {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "PUT, OPTIONS",
        "access-control-allow-headers": "content-type",
      };
      if (route.request().method() === "OPTIONS") {
        return route.fulfill({ status: 204, headers: corsHeaders });
      }
      return route.fulfill({ status: 200, body: "", headers: corsHeaders });
    });
    await studentsPage.goto();
    await studentsPage.row("Ayesha Khan").click();
    await page.getByRole("tab", { name: /^documents$/i }).click();
    await page.getByRole("button", { name: /upload document/i }).click();

    await page.getByLabel(/^file$/i).setInputFiles({
      name: "birth-cert.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("fake pdf bytes"),
    });
    // A title distinct from "Birth certificate" — the default document type (never
    // changed here) already renders that exact string as its own type label, and a title
    // matching it would make `getByText` match two elements and fail Playwright's
    // strict-mode check.
    await page.getByLabel(/^title$/i).fill("Ayesha's birth certificate scan");
    // Scoped to the open dialog: the tab's own "Upload document" trigger button stays
    // mounted behind it and shares this exact text in its non-pending state.
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^upload document$/i })
      .click();

    await expect(page.getByText("Ayesha's birth certificate scan")).toBeVisible();
    await expect(page.getByText(/pending/i)).toBeVisible();

    // Prefix-anchored — the row's own button carries a row-specific accessible name
    // ("Verify — <document title>", WCAG 2.4.6), not plain "Verify".
    await page.getByRole("button", { name: /^verify/i }).click();
    await expect(page.getByText(/^verified$/i)).toBeVisible();
  });

  test("deletes a document after confirming", async ({
    page,
    signedIn: _signedIn,
    mockApi,
    studentsPage,
  }) => {
    const document = buildStudentDocument({
      id: "document-0001",
      student_id: "student-0001",
      title: "Old document",
    });
    mockApi.use(
      schoolOrganizationModule({ campuses, houses: [] }),
      studentsModule({ students: [student] }),
      guardiansModule({}),
      studentRelationsModule({ documents: [document] }),
    );
    await studentsPage.goto();
    await studentsPage.row("Ayesha Khan").click();
    await page.getByRole("tab", { name: /^documents$/i }).click();
    // Prefix-anchored — the row's own button carries a row-specific accessible name
    // ("Delete — <document title>", WCAG 2.4.6), not plain "Delete".
    await page.getByRole("button", { name: /^delete/i }).click();
    // Scoped to the open confirmation dialog: its own confirm button has no row-specific
    // suffix, so it's still exactly "Delete" — scoping (not the name) disambiguates it.
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: /^delete$/i })
      .click();

    await expect(page.getByText("Old document")).toHaveCount(0);
  });
});

test.describe("student detail sheet — relations tabs, view-only permissions", () => {
  test.use({
    authUser: buildUser({
      // View-only: granted exactly enough to see the tabs (Task 10 gates each
      // `TabsTrigger` on its own view key — `students.student.view`, already in
      // `SCHOOL_ADMIN_PERMISSIONS`, covers Emergency Contacts), never the create/update/
      // verify/delete keys those tabs' own action buttons are gated on. Without
      // `.guardian.view`/`.document.view` explicitly added here, the Guardians and
      // Documents tabs wouldn't render at all and the clicks below would time out.
      permissions: [
        ...SCHOOL_ADMIN_PERMISSIONS,
        "students.guardian.view",
        "students.document.view",
      ],
    }),
  });

  test("hides every relation-tab action for a caller without those permissions", async ({
    page,
    signedIn: _signedIn,
    mockApi,
    studentsPage,
  }) => {
    const contact = buildEmergencyContact({ student_id: "student-0001", name: "Hamza Raza" });
    mockApi.use(
      schoolOrganizationModule({ campuses, houses: [] }),
      studentsModule({ students: [student] }),
      guardiansModule({}),
      studentRelationsModule({ emergencyContacts: [contact] }),
    );
    await studentsPage.goto();
    await studentsPage.row("Ayesha Khan").click();

    await page.getByRole("tab", { name: /^guardians$/i }).click();
    await expect(page.getByRole("button", { name: /link guardian/i })).toHaveCount(0);

    await page.getByRole("tab", { name: /emergency contacts/i }).click();
    await expect(page.getByRole("button", { name: /add contact/i })).toHaveCount(0);

    await page.getByRole("tab", { name: /^documents$/i }).click();
    await expect(page.getByRole("button", { name: /upload document/i })).toHaveCount(0);
  });
});
