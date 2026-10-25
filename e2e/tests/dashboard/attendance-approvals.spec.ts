import { expect, test } from "@/fixtures";
import {
  ATTENDANCE_CORRECTION_APPROVER_PERMISSIONS,
  ATTENDANCE_LEAVE_APPROVER_PERMISSIONS,
  ATTENDANCE_MARKER_PERMISSIONS,
  buildRole,
  buildUser,
  uuid,
} from "@/data/factories";
import { isApiCall } from "@/lib/request-matchers";
import {
  APPROVAL_MESSAGES,
  AttendanceApprovalsStore,
  type AttendanceApprovalsOptions,
  attendanceApprovalsModule,
  buildCorrection,
  buildLeaveRequest,
  buildLeaveType,
  jobsModule,
  type MockApi,
} from "@/mocks";

/**
 * `/attendance/corrections` and `/attendance/leave` against a stubbed API: a principal decides a
 * correction and is offered nothing on their own; a request decided elsewhere first shows the
 * server's 409 sentence; a teacher sees only their own corrections; a class teacher approves a
 * short leave, moves an escalated one to level 2, is refused a level 2 their scope cannot take,
 * and a rejected request's level 2 reads "Not reached"; an attachment downloads. The stub
 * (`attendanceApprovalsModule`) runs `decide_correction`'s and `decide_leave_step`'s rules in the
 * service's order with its sentences (L5); whether the server agrees, and which rows a scope
 * reaches, is the Django suite's job (`tests/test_approvals_api.py`).
 */

const OTHER_TEACHER_ID = uuid();
const OTHER_APPROVER_ID = uuid();

// UUID-shaped user ids: the screens compare them with `requested_by`, `submitted_by` and
// `approver_id`, which the API types as UUIDs.
const principal = buildUser({
  id: uuid(),
  full_name: "Ayesha Rahman",
  permissions: ATTENDANCE_CORRECTION_APPROVER_PERMISSIONS,
  roles: [buildRole({ slug: "principal", name: "Principal", scope: "all" })],
});

const teacher = buildUser({
  id: uuid(),
  full_name: "Imran Siddiqui",
  permissions: ATTENDANCE_MARKER_PERMISSIONS,
  roles: [buildRole({ slug: "teacher", name: "Teacher", scope: "assigned" })],
});

const classTeacher = buildUser({
  id: uuid(),
  full_name: "Noor Usman",
  permissions: ATTENDANCE_LEAVE_APPROVER_PERMISSIONS,
  roles: [buildRole({ slug: "class_teacher", name: "Class Teacher", scope: "assigned" })],
});

const CORRECTION_DECIDE_PATH = /\/attendance-corrections\/[^/]+:(approve|reject)$/;
const CORRECTIONS_PATH = /\/attendance-corrections$/;
const LEAVE_DECIDE_PATH = /\/leave-requests\/[^/]+:(approve|reject)$/;

/** A fresh server per test, for the signed-in `user`. */
function stubApprovals(mockApi: MockApi, options: AttendanceApprovalsOptions) {
  const store = new AttendanceApprovalsStore(options);
  mockApi.use(attendanceApprovalsModule(store));
  return store;
}

test.describe("corrections, as a principal", () => {
  test.use({ authUser: principal });

  /** Two requests from a teacher and one the principal raised themselves. */
  function queue() {
    return {
      amna: buildCorrection({
        student_name: "Amna Raza",
        requested_by: OTHER_TEACHER_ID,
        requested_by_name: "Imran Siddiqui",
        created_at: "2026-10-20T08:00:00Z",
      }),
      bilal: buildCorrection({
        student_name: "Bilal Khan",
        requested_by: principal.id,
        requested_by_name: principal.full_name,
        created_at: "2026-10-21T08:00:00Z",
      }),
      sara: buildCorrection({
        student_name: "Sara Ali",
        requested_by: OTHER_TEACHER_ID,
        requested_by_name: "Imran Siddiqui",
        created_at: "2026-10-22T08:00:00Z",
      }),
    };
  }

  test("approves a teacher's correction, and is offered no decision on their own", async ({
    page,
    mockApi,
    attendanceCorrectionsPage,
    signedIn: _signedIn,
  }) => {
    const { amna, bilal, sara } = queue();
    const store = stubApprovals(mockApi, { user: principal, corrections: [amna, bilal, sara] });
    await attendanceCorrectionsPage.goto();

    // Their own request is listed, with nothing to decide: approver ≠ requester (§11).
    await expect(attendanceCorrectionsPage.row("Bilal Khan")).toContainText("Pending");
    await expect(attendanceCorrectionsPage.decide("Bilal Khan", "Approve")).toHaveCount(0);
    await expect(attendanceCorrectionsPage.decide("Bilal Khan", "Reject")).toHaveCount(0);

    await attendanceCorrectionsPage.decide("Amna Raza", "Approve").click();
    await attendanceCorrectionsPage.note("Approve").fill("Checked against the class register.");
    const request = page.waitForRequest((r) => isApiCall(r, "POST", CORRECTION_DECIDE_PATH));
    await attendanceCorrectionsPage.submit("Approve").click();

    const sent = await request;
    expect(new URL(sent.url()).pathname).toMatch(new RegExp(`/${amna.id}:approve$`));
    expect(sent.postDataJSON()).toEqual({ review_note: "Checked against the class register." });
    await expect(page.getByText("Correction approved.")).toBeVisible();
    // Decided, it leaves the pending queue; the other two stay.
    await expect(attendanceCorrectionsPage.row("Amna Raza")).toHaveCount(0);
    await expect(attendanceCorrectionsPage.row("Sara Ali")).toBeVisible();
    expect(store.correction(amna.id)?.status).toBe("approved");

    await attendanceCorrectionsPage.filterStatus("Approved");
    await expect(attendanceCorrectionsPage.row("Amna Raza")).toContainText("Approved");
    await expect(attendanceCorrectionsPage.row("Amna Raza")).toContainText(
      `Reviewed by ${principal.full_name}`,
    );
    await expect(attendanceCorrectionsPage.decide("Amna Raza", "Reject")).toHaveCount(0);
  });

  test("a correction decided elsewhere first shows the server's sentence", async ({
    page,
    mockApi,
    attendanceCorrectionsPage,
    signedIn: _signedIn,
  }) => {
    const { amna, sara } = queue();
    const store = stubApprovals(mockApi, { user: principal, corrections: [amna, sara] });
    await attendanceCorrectionsPage.goto();
    await attendanceCorrectionsPage.decide("Sara Ali", "Reject").click();

    // Another approver approves it while this dialog is open.
    const decided = store.correction(sara.id);
    if (!decided) throw new Error("expected Sara's correction");
    decided.status = "approved";
    decided.reviewed_by = OTHER_APPROVER_ID;
    decided.reviewed_by_name = "Zainab Qureshi";

    const request = page.waitForRequest((r) => isApiCall(r, "POST", CORRECTION_DECIDE_PATH));
    await attendanceCorrectionsPage.submit("Reject").click();
    await request;

    await expect(attendanceCorrectionsPage.dialog("Reject")).toContainText(
      APPROVAL_MESSAGES.correctionDecided("approved"),
    );
    await expect(attendanceCorrectionsPage.submit("Reject")).toBeDisabled();
    expect(store.correction(sara.id)?.status).toBe("approved");

    // The queue behind the (modal) dialog reloaded: once it closes, the request is no longer
    // pending, and the Approved view shows who decided it.
    await attendanceCorrectionsPage.cancel("Reject").click();
    await expect(attendanceCorrectionsPage.row("Amna Raza")).toBeVisible();
    await expect(attendanceCorrectionsPage.row("Sara Ali")).toHaveCount(0);
    await attendanceCorrectionsPage.filterStatus("Approved");
    await expect(attendanceCorrectionsPage.row("Sara Ali")).toContainText(
      "Reviewed by Zainab Qureshi",
    );
  });
});

test.describe("corrections, as a teacher", () => {
  test.use({ authUser: teacher });

  test("sees only their own requests, with nothing to decide", async ({
    page,
    mockApi,
    dashboardPage,
    attendanceCorrectionsPage,
    signedIn: _signedIn,
  }) => {
    stubApprovals(mockApi, {
      user: teacher,
      corrections: [
        buildCorrection({
          student_name: "Amna Raza",
          requested_by: teacher.id,
          requested_by_name: teacher.full_name,
        }),
        buildCorrection({
          student_name: "Bilal Khan",
          requested_by: OTHER_TEACHER_ID,
          requested_by_name: "Zainab Qureshi",
        }),
      ],
    });
    await attendanceCorrectionsPage.goto();

    await expect(dashboardPage.sectionTab("Corrections", "Attendance")).toBeVisible();
    await expect(dashboardPage.sectionTab("Leave", "Attendance")).toHaveCount(0);
    // An `assigned` caller reads their own requests only, whichever key let them in.
    await expect(attendanceCorrectionsPage.row("Amna Raza")).toContainText(teacher.full_name);
    await expect(attendanceCorrectionsPage.row("Bilal Khan")).toHaveCount(0);
    await expect(attendanceCorrectionsPage.decide("Amna Raza", "Approve")).toHaveCount(0);

    // Mine narrows to the caller's own requests: `mine=true` on the list.
    const request = page.waitForRequest(
      (r) =>
        isApiCall(r, "GET", CORRECTIONS_PATH) &&
        new URL(r.url()).searchParams.get("mine") === "true",
    );
    await attendanceCorrectionsPage.mine.check();
    await request;

    await expect(attendanceCorrectionsPage.row("Amna Raza")).toBeVisible();
    await expect(attendanceCorrectionsPage.row("Bilal Khan")).toHaveCount(0);
  });
});

test.describe("leave, as a class teacher", () => {
  test.use({ authUser: classTeacher });

  const sick = buildLeaveType({ name: "Sick leave", code: "SICK" });

  /** Twelve days is past the default ten-day threshold, so the chain has a second level. */
  function escalated(student: string) {
    return buildLeaveRequest({ days: 12, leaveType: sick }, { student_name: student });
  }

  test("approves a short leave; an escalated one moves to level 2", async ({
    page,
    mockApi,
    attendanceLeavePage,
    signedIn: _signedIn,
  }) => {
    const amna = buildLeaveRequest(
      { days: 3, leaveType: sick },
      { student_name: "Amna Raza", created_at: "2026-10-20T08:00:00Z" },
    );
    const bilal = escalated("Bilal Khan");
    // Level 1 already approved by another teacher: level 2 needs a campus or school-wide scope.
    const zainab = escalated("Zainab Qureshi");
    const firstStep = zainab.approvals[0];
    if (!firstStep) throw new Error("expected level 1");
    firstStep.decision = "approved";
    firstStep.approver_id = OTHER_TEACHER_ID;
    firstStep.approver_name = "Imran Siddiqui";
    firstStep.decided_at = "2026-10-21T09:00:00Z";
    zainab.current_approval_level = 2;
    const store = stubApprovals(mockApi, {
      user: classTeacher,
      leaveRequests: [amna, bilal, zainab],
      leaveTypes: [sick],
    });
    await attendanceLeavePage.goto();

    await attendanceLeavePage.decide("Amna Raza", "Approve").click();
    const approval = page.waitForRequest((r) => isApiCall(r, "POST", LEAVE_DECIDE_PATH));
    await attendanceLeavePage.submit("Approve").click();

    expect((await approval).postDataJSON()).toEqual({});
    await expect(page.getByText("Leave approved. 3 days marked as on leave.")).toBeVisible();
    await expect(attendanceLeavePage.row("Amna Raza")).toHaveCount(0);

    await attendanceLeavePage.decide("Bilal Khan", "Approve").click();
    await attendanceLeavePage.submit("Approve").click();

    await expect(page.getByText("Approved. The request now waits for level 2.")).toBeVisible();
    // Still pending, now at level 2, and this approver may not take a second level.
    await expect(attendanceLeavePage.row("Bilal Khan")).toContainText("2 of 2");
    await expect(attendanceLeavePage.row("Bilal Khan")).toContainText("Pending");
    await expect(attendanceLeavePage.decide("Bilal Khan", "Approve")).toHaveCount(0);

    await attendanceLeavePage.openDetail("Bilal Khan");
    await expect(attendanceLeavePage.chainStep("Bilal Khan", 1)).toContainText("Approved");
    await expect(attendanceLeavePage.chainStep("Bilal Khan", 1)).toContainText(
      classTeacher.full_name,
    );
    await expect(attendanceLeavePage.chainStep("Bilal Khan", 2)).toContainText("Pending");
    await expect(attendanceLeavePage.chainStep("Bilal Khan", 2)).toContainText(
      "Waiting for a decision",
    );
    await page.keyboard.press("Escape");
    await expect(attendanceLeavePage.detail("Bilal Khan")).toBeHidden();

    // The browser cannot see scope, so the button shows; the server refuses an `assigned` one.
    await attendanceLeavePage.decide("Zainab Qureshi", "Approve").click();
    await attendanceLeavePage.submit("Approve").click();

    await expect(attendanceLeavePage.dialog("Approve")).toContainText(
      APPROVAL_MESSAGES.escalationScope,
    );
    expect(store.leaveRequest(zainab.id)?.approvals[1]?.decision).toBe("pending");
  });

  test("a rejected escalated request shows level 2 as not reached", async ({
    page,
    mockApi,
    attendanceLeavePage,
    signedIn: _signedIn,
  }) => {
    const sara = escalated("Sara Ali");
    const store = stubApprovals(mockApi, {
      user: classTeacher,
      leaveRequests: [sara],
      leaveTypes: [sick],
    });
    await attendanceLeavePage.goto();

    await attendanceLeavePage.decide("Sara Ali", "Reject").click();
    await attendanceLeavePage.note("Reject").fill("Exams that week; please reapply.");
    const rejection = page.waitForRequest((r) => isApiCall(r, "POST", LEAVE_DECIDE_PATH));
    await attendanceLeavePage.submit("Reject").click();

    expect((await rejection).postDataJSON()).toEqual({ note: "Exams that week; please reapply." });
    await expect(page.getByText("Leave request rejected.")).toBeVisible();
    await expect(attendanceLeavePage.row("Sara Ali")).toHaveCount(0);
    expect(store.leaveRequest(sara.id)?.status).toBe("rejected");

    await attendanceLeavePage.filterStatus("Rejected");
    await expect(attendanceLeavePage.row("Sara Ali")).toContainText("Rejected");
    await expect(attendanceLeavePage.row("Sara Ali")).toContainText("1 of 2");

    await attendanceLeavePage.openDetail("Sara Ali");
    await expect(attendanceLeavePage.chainStep("Sara Ali", 1)).toContainText("Rejected");
    await expect(attendanceLeavePage.chainStep("Sara Ali", 1)).toContainText(
      "Exams that week; please reapply.",
    );
    // A rejection decides only its own step: level 2 was never reached, and nobody waits on it.
    await expect(attendanceLeavePage.chainStep("Sara Ali", 2)).toContainText("Not reached");
    await expect(attendanceLeavePage.chainStep("Sara Ali", 2)).not.toContainText("Pending");
    await expect(attendanceLeavePage.chainStep("Sara Ali", 2)).not.toContainText(
      "Waiting for a decision",
    );
  });

  test("downloads a request's attachment", async ({
    page,
    mockApi,
    attendanceLeavePage,
    signedIn: _signedIn,
  }) => {
    const fileId = uuid();
    const fileUrl = `https://storage.e2e.test/objects/${fileId}-medical-note.bin`;
    stubApprovals(mockApi, {
      user: classTeacher,
      leaveRequests: [
        buildLeaveRequest(
          { days: 2, leaveType: sick },
          { student_name: "Amna Raza", attachment_file_id: fileId },
        ),
      ],
      leaveTypes: [sick],
    });
    // `POST /files/{id}:download` is `jobsModule`'s: the router lets one module own the path.
    mockApi.use(jobsModule({ files: [{ id: fileId, downloadUrl: fileUrl }] }));
    // Storage signs the URL with `Content-Disposition: attachment`, which is what makes
    // Chromium emit the `download` event for a cross-origin link.
    await page.route(fileUrl, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/pdf",
        headers: { "content-disposition": 'attachment; filename="medical-note.pdf"' },
        body: "%PDF-1.4",
      }),
    );
    await attendanceLeavePage.goto();

    await attendanceLeavePage.openDetail("Amna Raza");
    const downloadPromise = page.waitForEvent("download");
    await attendanceLeavePage.downloadAttachment("Amna Raza").click();
    const download = await downloadPromise;

    expect(download.url()).toBe(fileUrl);
  });
});
