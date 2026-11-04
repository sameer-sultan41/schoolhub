import type { ApiClient, ApiSchemas } from "@schoolhub/api-client";
import { buildLiveThread } from "@/data/live-factories";
import { env } from "@/env";
import { expect, test } from "@/fixtures";
import { createLiveSession } from "@/lib/live-api";
import {
  E2E_COMMS_CLASS_TEACHER_EMAIL,
  E2E_COMMS_GUARDIAN_EMAIL,
  E2E_COMMS_STUDENT_ADMISSION_NUMBER,
  E2E_PORTAL_EXAM_NAME,
  E2E_PORTAL_FEE_AMOUNT,
  E2E_PORTAL_NOTICE_TITLE,
  E2E_PORTAL_RESULT_GRADE,
  E2E_PORTAL_RESULT_PERCENTAGE,
  E2E_UNLINKED_STUDENT_ADMISSION_NUMBER,
} from "@/lib/seed-constants";

/**
 * Live API lane — no browser. See campuses.spec.ts's header for the shared rationale.
 *
 * What this lane proves that the Django suite cannot: that a real guardian login, through
 * real PostgreSQL under the NOSUPERUSER role, gets its own child's records and nothing else.
 * The summary's cards are read through each module's own visibility rules, the inbox is
 * the caller's own rows, and RLS keeps the other tenant out of all of it.
 *
 * The data is seed_e2e_data.py's comms fixture plus the portal fixtures it runs
 * (`apps/parent_portal/management/commands/seed_e2e_portal.py`): the comms guardian is
 * linked to the comms student, who has attendance for today, one outstanding invoice, one
 * published result and one notice needing acknowledgement.
 *
 * Endpoints covered: `GET /parent-portal/dashboard`, `GET /timetables/my?student_id=`,
 * `GET /notifications`, `GET /notifications:unread-count`, `POST /notifications/{id}:mark-read`,
 * `GET /notices`, `GET /notices/{id}`, `POST /notices/{id}:acknowledge`, read alongside
 * `GET /fee-invoices`, `GET /results` and `GET /reports/attendance-summary`.
 *
 * Logins: the comms guardian and the comms class teacher, each once per worker
 * (`sessionFor`); the owner and the other tenant's owner are the shared fixtures.
 */

type Dashboard = ApiSchemas["PortalDashboard"];
type PortalChild = ApiSchemas["PortalChild"];
type Notification = ApiSchemas["Notification"];
type PortalNotice = ApiSchemas["PortalNotice"];
type UnreadCount = ApiSchemas["UnreadCount"];
type MarkReadResult = ApiSchemas["NotificationMarkReadResult"];
type Invoice = ApiSchemas["FeeInvoice"];
type Result = ApiSchemas["Result"];
type StudentSummaryRow = ApiSchemas["StudentSummaryReportRow"];
type Thread = ApiSchemas["MessageThread"];

/** apps/communication/notifications.py's trigger key for a thread reply. */
const THREAD_REPLY = "communication.thread-reply";

const logins = new Map<string, Promise<ApiClient>>();

/** One login per identity per worker (e2e/AGENTS.md, the auth throttle). */
function sessionFor(identifier: string): Promise<ApiClient> {
  let login = logins.get(identifier);
  if (!login) {
    login = createLiveSession({ identifier, password: env.LIVE_ADMIN_PASSWORD });
    logins.set(identifier, login);
  }
  return login;
}

async function studentIdByAdmissionNumber(admin: ApiClient, admissionNumber: string) {
  const listed = await admin.get<{ id: string; admission_number: string }[]>("/students", {
    query: { search: admissionNumber },
  });
  const student = listed.data.find((row) => row.admission_number === admissionNumber);
  if (!student) throw new Error(`${admissionNumber} is missing — run manage.py seed_e2e_data`);
  return student.id;
}

/** The first and last day of the month containing `isoDate`, as ISO dates. */
function monthOf(isoDate: string): { start: string; end: string } {
  const [year, month] = isoDate.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(last).padStart(2, "0")}` };
}

function childOf(dashboard: Dashboard): PortalChild {
  const [child] = dashboard.children;
  if (!child) throw new Error("the comms guardian sees no child — run manage.py seed_e2e_data");
  return child;
}

test.describe("parent portal (live API)", () => {
  test("the dashboard summary matches the seeded records and each module's own reads", async ({
    liveApiClient,
  }) => {
    const studentId = await studentIdByAdmissionNumber(
      liveApiClient,
      E2E_COMMS_STUDENT_ADMISSION_NUMBER,
    );
    const guardian = await sessionFor(E2E_COMMS_GUARDIAN_EMAIL);

    const me = await guardian.get<ApiSchemas["User"]>("/auth/me");
    expect(me.data.is_restricted_principal).toBe(true);

    const dashboard = (await guardian.get<Dashboard>("/parent-portal/dashboard")).data;
    // Exactly the one linked child, every module on and every key held.
    expect(dashboard.children).toHaveLength(1);
    const child = childOf(dashboard);
    expect(child.student.id).toBe(studentId);
    expect(child.student.admission_number).toBe(E2E_COMMS_STUDENT_ADMISSION_NUMBER);
    expect(dashboard.modules).toEqual({
      attendance: true,
      fees: true,
      examinations: true,
      communication: true,
      timetable: true,
    });

    // Fees: the one seeded invoice, and the same set `/fee-invoices?outstanding=true` gives
    // the guardian, so the card and the list cannot disagree.
    const fees = child.fees;
    if (!fees) throw new Error("the fees card is null although the module is on");
    expect(Number(fees.outstanding_total)).toBe(Number(E2E_PORTAL_FEE_AMOUNT));
    expect(fees.outstanding_count).toBe(1);
    const invoices = await guardian.get<Invoice[]>("/fee-invoices", {
      query: { student: studentId, outstanding: "true", page_size: 100 },
    });
    expect(invoices.data).toHaveLength(1);
    expect(fees.next_due_date).toBe(invoices.data[0]?.due_date);
    expect(Number(invoices.data[0]?.balance_due)).toBe(Number(fees.outstanding_total));

    // Examinations: the published result, as `/results` shows it to the guardian.
    const latest = child.latest_result;
    if (!latest) throw new Error("the results card is null although a result is published");
    expect(latest.exam_name).toBe(E2E_PORTAL_EXAM_NAME);
    expect(Number(latest.percentage)).toBe(Number(E2E_PORTAL_RESULT_PERCENTAGE));
    expect(latest.grade).toBe(E2E_PORTAL_RESULT_GRADE);
    const results = await guardian.get<Result[]>("/results", {
      query: { student_id: studentId, page_size: 100 },
    });
    expect(results.data.length).toBeGreaterThan(0);
    expect(results.data.every((row) => row.status === "published")).toBe(true);

    // Attendance: seeded present today, and the month's figures are attendance's own §13
    // summary for this child, computed on the server both times.
    const attendance = child.attendance;
    if (!attendance) throw new Error("the attendance card is null although the module is on");
    expect(attendance.today).toBe("present");
    expect(attendance.month_counted_days).toBeGreaterThan(0);
    const { start, end } = monthOf(new Date().toISOString().slice(0, 10));
    const report = await liveApiClient.get<StudentSummaryRow[]>("/reports/attendance-summary", {
      query: { kind: "student-summary", start_date: start, end_date: end },
    });
    const row = report.data.find((entry) => entry.student_id === studentId);
    if (!row) throw new Error("the attendance report has no row for the comms student");
    expect(attendance.month_counted_days).toBe(row.counted_days);
    expect(attendance.month_present_days).toBe(row.present_days);
    expect(Number(attendance.month_percentage)).toBe(row.attendance_rate);

    // The inbox count on the summary is the inbox's own figure. Other tests in this file can
    // add a reply notification at any moment, so it is read as a lower bound, not equality.
    const unread = (await guardian.get<UnreadCount>("/notifications:unread-count")).data.unread;
    // The seeded notice's notification is never marked read, so there is at least one.
    expect(dashboard.unread_notifications).toBeGreaterThan(0);
    expect(dashboard.unread_notifications).toBeLessThanOrEqual(unread);
  });

  test("a child the guardian is not linked to is a 404, and their own child's week is served", async ({
    liveApiClient,
  }) => {
    const [linked, unlinked] = await Promise.all([
      studentIdByAdmissionNumber(liveApiClient, E2E_COMMS_STUDENT_ADMISSION_NUMBER),
      studentIdByAdmissionNumber(liveApiClient, E2E_UNLINKED_STUDENT_ADMISSION_NUMBER),
    ]);
    const guardian = await sessionFor(E2E_COMMS_GUARDIAN_EMAIL);

    // The student exists in this tenant, so a 404 rather than a 403 is the point (ADR-0004).
    await expect(
      guardian.get("/timetables/my", { query: { student_id: unlinked } }),
    ).rejects.toMatchObject({ status: 404 });

    // The linked child is enrolled in the baseline section, whose week is seeded published.
    const week = await guardian.get<{ section_id: string }[]>("/timetables/my", {
      query: { student_id: linked },
    });
    expect(week.meta?.audience).toBe("learner");
    expect(week.data.length).toBeGreaterThan(0);
  });

  test("a staff reply to the guardian's thread arrives in the guardian's inbox", async ({
    liveApiClient,
  }) => {
    const studentId = await studentIdByAdmissionNumber(
      liveApiClient,
      E2E_COMMS_STUDENT_ADMISSION_NUMBER,
    );
    const guardian = await sessionFor(E2E_COMMS_GUARDIAN_EMAIL);
    const teacher = await sessionFor(E2E_COMMS_CLASS_TEACHER_EMAIL);

    const thread = (await guardian.post<Thread>("/message-threads", buildLiveThread(studentId)))
      .data;
    await teacher.post(`/message-threads/${thread.id}/messages`, {
      body: `On it. (${thread.subject})`,
    });

    const inbox = await guardian.get<Notification[]>("/notifications", {
      query: { read: "false", page_size: 100 },
    });
    const reply = inbox.data.find(
      (row) => row.source_id === thread.id && row.event_key === THREAD_REPLY,
    );
    if (!reply) throw new Error("the guardian's inbox has no reply notification for the thread");
    expect(reply.read_at).toBeNull();
    expect((await guardian.get<Notification>(`/notifications/${reply.id}`)).data.id).toBe(reply.id);

    const marked = await guardian.post<MarkReadResult>(`/notifications/${reply.id}:mark-read`, {});
    expect(marked.data.read_at).toBeTruthy();
    const stillUnread = await guardian.get<Notification[]>("/notifications", {
      query: { read: "false", page_size: 100 },
    });
    expect(stillUnread.data.map((row) => row.id)).not.toContain(reply.id);

    // The teacher's inbox holds their own rows only: the guardian's reply row is a 404 there.
    await expect(teacher.get(`/notifications/${reply.id}`)).rejects.toMatchObject({
      status: 404,
    });
  });

  test("the guardian lists the seeded notice in the portal shape and acknowledges it", async () => {
    const guardian = await sessionFor(E2E_COMMS_GUARDIAN_EMAIL);

    const listed = await guardian.get<PortalNotice[]>("/notices", { query: { page_size: 100 } });
    const notice = listed.data.find((row) => row.title === E2E_PORTAL_NOTICE_TITLE);
    if (!notice) throw new Error("the seeded notice is missing — run manage.py seed_e2e_data");
    // The portal shape: no audience, approver or status for a guardian to read.
    expect(Object.keys(notice).sort()).toEqual(
      [
        "acknowledged_at",
        "body",
        "id",
        "notice_no",
        "notice_type",
        "published_at",
        "requires_acknowledgment",
        "title",
      ].sort(),
    );
    expect(notice.requires_acknowledgment).toBe(true);
    expect(notice.notice_no).toBeTruthy();

    // Idempotent: a re-seeded database may already hold an acknowledgement, and a second
    // tap is a no-op rather than an error.
    await guardian.post(`/notices/${notice.id}:acknowledge`, {});
    await guardian.post(`/notices/${notice.id}:acknowledge`, {});
    const after = (await guardian.get<PortalNotice>(`/notices/${notice.id}`)).data;
    expect(after.acknowledged_at).toBeTruthy();
  });

  test("the other tenant sees none of this tenant's portal records", async ({
    liveApiClient,
    liveOtherTenantApiClient,
  }) => {
    const studentId = await studentIdByAdmissionNumber(
      liveApiClient,
      E2E_COMMS_STUDENT_ADMISSION_NUMBER,
    );
    const guardian = await sessionFor(E2E_COMMS_GUARDIAN_EMAIL);
    const notices = await guardian.get<PortalNotice[]>("/notices", { query: { page_size: 100 } });
    const notice = notices.data.find((row) => row.title === E2E_PORTAL_NOTICE_TITLE);
    const inbox = await guardian.get<Notification[]>("/notifications", {
      query: { page_size: 1 },
    });
    if (!notice || !inbox.data[0])
      throw new Error("the seeded notice or its notification is missing");

    // The other tenant's owner holds every key with every module on, and still sees no child.
    const dashboard = (await liveOtherTenantApiClient.get<Dashboard>("/parent-portal/dashboard"))
      .data;
    expect(dashboard.children).toEqual([]);

    for (const path of [`/notices/${notice.id}`, `/notifications/${inbox.data[0].id}`]) {
      await expect(liveOtherTenantApiClient.get(path)).rejects.toMatchObject({ status: 404 });
    }
    await expect(
      liveOtherTenantApiClient.get("/timetables/my", { query: { student_id: studentId } }),
    ).rejects.toMatchObject({ status: 404 });
    const invoices = await liveOtherTenantApiClient.get<Invoice[]>("/fee-invoices", {
      query: { student: studentId },
    });
    expect(invoices.data).toEqual([]);
  });
});
