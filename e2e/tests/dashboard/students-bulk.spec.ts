import { expect, test } from "@/fixtures";
import { buildUser, SCHOOL_ADMIN_PERMISSIONS } from "@/data/factories";
import {
  buildCampus,
  buildStudent,
  ID_CARDS_JOB_ID,
  jobsModule,
  schoolOrganizationModule,
  STUDENT_EXPORT_JOB_ID,
  STUDENT_IMPORT_JOB_ID,
  studentsModule,
} from "@/mocks";

/**
 * The `/students` bulk operations — Export CSV, Import CSV and batch ID cards — against a
 * stubbed API.
 *
 * What this proves is the dashboard's half: the right request goes out, the job is watched,
 * and a file download or a per-row result reaches the user. The job itself (parsing,
 * validation, the generated file) is the API's own test suite's job; the stub returns
 * whatever it was told to.
 */

const campuses = [buildCampus({ id: "campus-0001", name: "Main Campus" })];

function directory() {
  return [
    buildStudent({
      id: "student-0001",
      admission_number: "2026-0001",
      first_name: "Ayesha",
      last_name: "Khan",
    }),
    buildStudent({
      id: "student-0002",
      admission_number: "2026-0002",
      first_name: "Bilal",
      last_name: "Ahmed",
    }),
  ];
}

/**
 * A storage download, fulfilled the way real storage serves a presigned one:
 * `core/files/services.py` signs it with `Content-Disposition: attachment`. A cross-origin
 * `<a download>` ignores the attribute, so that header is what makes Chromium emit the
 * `download` event reliably.
 */
function attachment(filename: string, contentType: string, body: string) {
  return {
    status: 200,
    contentType,
    headers: { "content-disposition": `attachment; filename="${filename}"` },
    body,
  };
}

test.describe("students bulk operations", () => {
  test.describe("with the bulk keys", () => {
    test.use({
      authUser: buildUser({
        permissions: [
          ...SCHOOL_ADMIN_PERMISSIONS,
          "students.student.export",
          "students.student.import",
          "students.id-card.generate",
        ],
      }),
    });

    test("Export CSV downloads the student list once the export job succeeds", async ({
      page,
      mockApi,
      signedIn: _signedIn,
      studentsPage,
    }) => {
      const fileUrl = "https://storage.e2e.test/objects/6b1d4c7e-students-export.bin";
      mockApi.use(
        schoolOrganizationModule({ campuses, houses: [] }),
        studentsModule({ students: directory() }),
        jobsModule({
          jobs: {
            [STUDENT_EXPORT_JOB_ID]: [
              { status: "running", progress: 0 },
              { status: "succeeded", progress: 100, result: { result_file_id: "file-students" } },
            ],
          },
          files: [{ id: "file-students", downloadUrl: fileUrl }],
        }),
      );
      await page.route(fileUrl, (route) =>
        route.fulfill(attachment("students-export.csv", "text/csv", "admission_number\n")),
      );
      await studentsPage.goto();
      await expect(studentsPage.row("Ayesha Khan")).toBeVisible();

      const downloadPromise = page.waitForEvent("download");
      await studentsPage.exportCsvButton.click();
      const download = await downloadPromise;

      expect(download.url()).toBe(fileUrl);
    });

    test("Import CSV shows the per-row result once the import job succeeds", async ({
      mockApi,
      signedIn: _signedIn,
      studentsPage,
    }) => {
      mockApi.use(
        schoolOrganizationModule({ campuses, houses: [] }),
        studentsModule({ students: directory() }),
        jobsModule({
          jobs: {
            [STUDENT_IMPORT_JOB_ID]: [
              {
                status: "succeeded",
                progress: 100,
                result: {
                  total: 2,
                  succeeded: 1,
                  failed: 1,
                  errors: [
                    {
                      row: "3",
                      field: "gender",
                      issue: "Must be one of: male, female, other, unspecified.",
                    },
                  ],
                },
              },
            ],
          },
        }),
      );
      await studentsPage.goto();
      await expect(studentsPage.row("Ayesha Khan")).toBeVisible();

      await studentsPage.importCsvButton.click();
      await studentsPage.importFileInput.setInputFiles({
        name: "students.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(
          [
            "first_name,last_name,date_of_birth,gender,campus_code,admission_date",
            "Zara,Hussain,2013-02-14,female,MAIN,2026-03-01",
            "Ayesha,Siddiqui,2012-07-09,boy,MAIN,2026-03-01",
          ].join("\n"),
        ),
      });
      await studentsPage.importSubmit.click();

      const dialog = studentsPage.importDialog;
      await expect(
        dialog.getByText("Must be one of: male, female, other, unspecified."),
      ).toBeVisible();
      await expect(dialog.getByText("1 imported")).toBeVisible();
      await expect(dialog.getByText("1 failed")).toBeVisible();
    });

    test("Generate ID cards sends the selected students and downloads the PDF", async ({
      page,
      mockApi,
      signedIn: _signedIn,
      studentsPage,
    }) => {
      const fileUrl = "https://storage.e2e.test/objects/c94a0f52-id-cards.bin";
      const requested: string[][] = [];
      mockApi.use(
        schoolOrganizationModule({ campuses, houses: [] }),
        studentsModule({
          students: directory(),
          onIdCardsRequested: (ids) => requested.push(ids),
        }),
        jobsModule({
          jobs: {
            [ID_CARDS_JOB_ID]: [
              { status: "running", progress: 40 },
              {
                status: "succeeded",
                progress: 100,
                result: { result_file_id: "file-id-cards", count: 2 },
              },
            ],
          },
          files: [{ id: "file-id-cards", downloadUrl: fileUrl }],
        }),
      );
      await page.route(fileUrl, (route) =>
        route.fulfill(attachment("id-cards.pdf", "application/pdf", "%PDF-1.4\n")),
      );
      await studentsPage.goto();
      await expect(studentsPage.row("Ayesha Khan")).toBeVisible();

      // Nothing selected, nothing to generate: the button only appears with a selection.
      await expect(studentsPage.idCardsButton).toHaveCount(0);
      await studentsPage.selectRow("Ayesha Khan").click();
      await studentsPage.selectRow("Bilal Ahmed").click();
      await expect(studentsPage.idCardsButton).toHaveText("Generate ID cards (2)");

      const downloadPromise = page.waitForEvent("download");
      await studentsPage.idCardsButton.click();
      const download = await downloadPromise;

      expect(download.url()).toBe(fileUrl);
      // One request, carrying both ids (sorted: the order is the table's, not the click's).
      expect(requested.map((ids) => [...ids].sort())).toEqual([["student-0001", "student-0002"]]);
      await expect(page.getByText("ID cards ready (2)")).toBeVisible();
    });
  });

  test("a user without the bulk keys sees Export and Import disabled and no ID-card button", async ({
    page,
    mockApi,
    signedIn: _signedIn,
    studentsPage,
  }) => {
    // The OUTER describe, so `signedIn`'s default `authUser` applies unmodified —
    // `SCHOOL_ADMIN_PERMISSIONS` (`e2e/src/data/factories.ts`). That constant is a
    // nav-filtering subset, not the real `school_admin` role, which does hold all three keys
    // (`STUDENT_IO` in `apps/api/apps/student_management/permissions.py`) — this proves the
    // gate, not a role.
    mockApi.use(
      schoolOrganizationModule({ campuses, houses: [] }),
      studentsModule({ students: directory() }),
    );
    await studentsPage.goto();
    await expect(studentsPage.row("Ayesha Khan")).toBeVisible();

    // A button is also disabled while permissions are still loading ("Checking your
    // permissions…"), so wait for the denial's own explanation, which only shows once the
    // user is known.
    await expect(page.getByTitle("You don't have permission to export students.")).toBeVisible();
    await expect(page.getByTitle("You don't have permission to import students.")).toBeVisible();
    await expect(studentsPage.exportCsvButton).toBeDisabled();
    await expect(studentsPage.importCsvButton).toBeDisabled();

    // A selection alone must not surface the button — the permission gates it.
    await studentsPage.selectRow("Ayesha Khan").click();
    await expect(studentsPage.selectRow("Ayesha Khan")).toBeChecked();
    await expect(studentsPage.idCardsButton).toHaveCount(0);
  });
});
