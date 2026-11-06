import { expect, test } from "@/fixtures";
import { buildGuardianUser } from "@/data/factories";
import { isApiCall } from "@/lib/request-matchers";
import {
  PORTAL_IDS,
  PortalStore,
  buildInvoice,
  buildPortalLeaveRequest,
  buildVoucher,
  filesModule,
  jobsModule,
  portalLeaveModule,
  portalModule,
  type MockApi,
  type PortalOptions,
} from "@/mocks";

/**
 * A guardian's write-side pages against a stubbed API, reached through the portal shell's tabs:
 * leave (a request for the child with the document its type asks for, and a withdrawal), the
 * fees page's vouchers, and changing the password. The stub (`portalModule`,
 * `portalLeaveModule`) answers with the server's shapes and rules (L5): a type that
 * `requires_attachment` is refused without a file, as `services.submit_leave_request` does. That
 * a guardian can attach only a file they uploaded, request leave only for their own child and
 * read only their own child's vouchers is the live lane's and the Django suite's job.
 */

const UPLOAD_URL = "https://files.example.test/upload-target";
const VOUCHER_DOWNLOAD_PATH = /\/vouchers\/[^/]+\/download$/;

/** A fresh server per test; `options` seeds what the test reads. */
function stubFamily(mockApi: MockApi, options: PortalOptions = {}): PortalStore {
  const store = new PortalStore(options);
  mockApi.use(
    portalModule(store),
    portalLeaveModule(store),
    filesModule({ uploadUrl: UPLOAD_URL }),
    jobsModule({}),
  );
  return store;
}

test.describe("a guardian's leave, vouchers and password", () => {
  test.use({ authUser: buildGuardianUser() });

  test("leave asks for the document the type needs, then lists the new request", async ({
    page,
    mockApi,
    portalPage,
    portalLeavePage,
    signedIn: _signedIn,
  }) => {
    const store = stubFamily(mockApi, {
      leaveRequests: [buildPortalLeaveRequest()],
    });
    // The storage PUT is a plain `fetch` to the presigned URL, so it needs its own route, with
    // the CORS answers its preflight asks for (see students-relations.spec.ts).
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
    await portalPage.goto();
    await portalPage.tab("Leave").click();

    await expect(portalLeavePage.heading).toHaveText("Leave requests");
    await expect(portalLeavePage.request("A cousin's wedding")).toContainText("Pending");

    await portalLeavePage.newRequest.click();
    await portalLeavePage.typeSelect.click();
    // Only the types a student may use: the staff-only one is not offered.
    await expect(page.getByRole("option")).toHaveText(["Sick leave", "Family event"]);
    await page.getByRole("option", { name: "Sick leave", exact: true }).click();
    await portalLeavePage.from.fill("2026-11-24");
    await portalLeavePage.to.fill("2026-11-25");
    await portalLeavePage.reason.fill("Fever and a doctor's visit");

    // Sick leave needs a document: nothing is sent without one.
    await portalLeavePage.submit.click();
    await expect(
      portalLeavePage.dialog.getByText("This leave type needs a supporting document."),
    ).toBeVisible();
    expect(store.leaveSubmissions).toHaveLength(0);

    await portalLeavePage.attachment.setInputFiles({
      name: "doctor-note.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("fake pdf bytes"),
    });
    await expect(portalLeavePage.dialog.getByText("doctor-note.pdf")).toBeVisible();
    await portalLeavePage.submit.click();

    await expect(portalLeavePage.dialog).toHaveCount(0);
    await expect(portalLeavePage.request("Fever and a doctor's visit")).toContainText("Pending");
    expect(store.leaveSubmissions).toHaveLength(1);
    expect(store.leaveSubmissions[0]).toMatchObject({
      student_id: PORTAL_IDS.ayesha,
      leave_type_id: PORTAL_IDS.sickLeave,
      start_date: "2026-11-24",
      end_date: "2026-11-25",
      reason: "Fever and a doctor's visit",
      attachment_file_id: expect.any(String),
    });
  });

  test("a pending request is withdrawn once confirmed", async ({
    mockApi,
    portalPage,
    portalLeavePage,
    signedIn: _signedIn,
  }) => {
    stubFamily(mockApi, { leaveRequests: [buildPortalLeaveRequest()] });
    await portalPage.goto();
    await portalPage.tab("Leave").click();

    const row = portalLeavePage.request("A cousin's wedding");
    await portalLeavePage.cancelButton(row).click();
    await portalLeavePage.cancelButton(portalLeavePage.confirmDialog).click();

    await expect(row).toContainText("Cancelled");
    await expect(portalLeavePage.cancelButton(row)).toHaveCount(0);
  });

  test("fees offers each open invoice its voucher as a PDF download", async ({
    page,
    mockApi,
    portalPage,
    portalLeavePage,
    signedIn: _signedIn,
  }) => {
    stubFamily(mockApi, { invoices: [buildInvoice()], vouchers: [buildVoucher()] });
    await portalPage.goto();
    await portalPage.tab("Fees").click();

    const request = page.waitForRequest((r) => isApiCall(r, "GET", VOUCHER_DOWNLOAD_PATH));
    const download = page.waitForEvent("download");
    await portalLeavePage.voucherButton("1234567890").click();

    expect((await download).suggestedFilename()).toBe("1234567890.pdf");
    const sent = await request;
    expect(new URL(sent.url()).pathname).toContain(`/vouchers/${PORTAL_IDS.voucher}/download`);
    expect(new URL(sent.url()).searchParams.get("format")).toBe("pdf");
  });

  test("an open invoice with no voucher says to ask the school office", async ({
    mockApi,
    portalPage,
    portalLeavePage,
    signedIn: _signedIn,
  }) => {
    stubFamily(mockApi, { invoices: [buildInvoice()] });
    await portalPage.goto();
    await portalPage.tab("Fees").click();

    await expect(portalLeavePage.noVoucher).toBeVisible();
  });

  test("settings changes the password, naming a wrong current one on its field", async ({
    page,
    mockApi,
    portalPage,
    portalLeavePage,
    signedIn: _signedIn,
  }) => {
    const store = stubFamily(mockApi);
    await portalPage.goto();
    await portalPage.tab("Settings").click();

    await portalLeavePage.currentPassword.fill("not-the-password");
    await portalLeavePage.newPassword.fill("a-better-password-2");
    await portalLeavePage.confirmPassword.fill("a-better-password-2");
    await portalLeavePage.changePassword.click();

    await expect(page.getByText("Current password is incorrect.")).toBeVisible();
    expect(store.passwordChanges).toHaveLength(0);

    await portalLeavePage.currentPassword.fill(store.password);
    await portalLeavePage.changePassword.click();

    await expect(page.getByText("Password changed.")).toBeVisible();
    expect(store.passwordChanges).toEqual([
      { current_password: store.password, new_password: "a-better-password-2" },
    ]);
    await expect(portalLeavePage.currentPassword).toHaveValue("");
  });
});
