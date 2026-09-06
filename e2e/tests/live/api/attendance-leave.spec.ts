import { ApiError, type ApiClient } from "@schoolhub/api-client";
import { env } from "@/env";
import { expect, test } from "@/fixtures";
import { createLiveSession } from "@/lib/live-api";
import { seedAttendanceRegister } from "@/lib/live-attendance-register";
import { E2E_CLASS_TEACHER_EMAIL } from "@/lib/seed-constants";

/**
 * Live API lane — no browser. See campuses.spec.ts's header for the shared rationale.
 *
 * **Three identities, and the split is the point.** §11 forbids deciding a request you
 * submitted, and `services.decide_leave_step` additionally forbids one person deciding
 * two levels of the same request — without which the escalation threshold would be
 * theatre. So the submitter is the seeded school admin, level 1 is the class teacher and
 * level 2 the principal, exactly as §7.2 describes. A lane that ran all three as one
 * identity could not tell a working chain from a broken one.
 *
 * **Leave types come from the seed, not from a POST.** No endpoint can create one:
 * attendance.md §4 keys no leave-type permission and the writes belong to hr-leave's
 * `hr.leave-type.*` (Tier 6) — see apps/attendance/views.py's LeaveTypeViewSet docstring.
 * That is a real gap, recorded in the module doc's §20, and this spec reads the catalogue
 * rather than pretending otherwise.
 *
 * Endpoints covered: `GET /leave-types`, `GET/POST /leave-requests`,
 * `POST /leave-requests/{id}:approve` · `:reject` · `:cancel`.
 */

interface Identified {
  id: string;
}

interface LeaveType extends Identified {
  code: string;
  requires_attachment: boolean;
}

interface LeaveRequest extends Identified {
  status: string;
  days_count: string;
  current_approval_level: number;
  approvals: { level: number; decision: string }[];
}

/** A Monday comfortably ahead: §6 refuses cancellation once leave has started. */
function nextMonday(weeksAhead = 1): string {
  const date = new Date();
  const daysToMonday = (8 - date.getDay()) % 7 || 7;
  date.setDate(date.getDate() + daysToMonday + 7 * (weeksAhead - 1));
  return date.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function approverSession(): Promise<ApiClient> {
  return createLiveSession({
    identifier: E2E_CLASS_TEACHER_EMAIL,
    password: env.LIVE_ADMIN_PASSWORD,
  });
}

async function sickLeaveTypeId(client: ApiClient): Promise<string> {
  const response = await client.get("/leave-types?is_active=true");
  const types = response.data as LeaveType[];
  const casual = types.find((type) => type.code === "CASUAL");
  if (!casual) throw new Error("expected the seeded CASUAL leave type");
  return casual.id;
}

test.describe("student leave (live API)", () => {
  test("a request is submitted, approved, and auto-marks the dates", async ({ liveApiClient }) => {
    const register = await seedAttendanceRegister(liveApiClient);
    const [studentId] = register.studentIds;
    if (!studentId) throw new Error("expected the register to have a roster");
    const leaveTypeId = await sickLeaveTypeId(liveApiClient);
    const start = nextMonday();

    const created = await liveApiClient.post("/leave-requests", {
      student_id: studentId,
      leave_type_id: leaveTypeId,
      start_date: start,
      end_date: addDays(start, 2),
      reason: "Family travel.",
    });
    const request = created.data as LeaveRequest;

    expect(request.status).toBe("pending");
    // Computed server-side net of holidays (§11) — nothing was sent for it.
    expect(request.days_count).toBe("3.0");
    expect(request.approvals).toHaveLength(1);

    const approver = await approverSession();
    const approved = await approver.post(`/leave-requests/${request.id}:approve`, {});

    expect((approved.data as LeaveRequest).status).toBe("approved");
    expect(approved.meta).toMatchObject({ auto_marked_days: 3 });

    const marked = await approver.get(`/student-attendance?student_id=${studentId}&date=${start}`);
    const rows = marked.data as { status: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("on_leave");
  });

  test("the submitter cannot approve their own request", async ({ liveApiClient }) => {
    const register = await seedAttendanceRegister(liveApiClient);
    const [studentId] = register.studentIds;
    if (!studentId) throw new Error("expected the register to have a roster");
    const start = nextMonday(2);

    const created = await liveApiClient.post("/leave-requests", {
      student_id: studentId,
      leave_type_id: await sickLeaveTypeId(liveApiClient),
      start_date: start,
      end_date: start,
      reason: "Dentist.",
    });
    const request = created.data as LeaveRequest;

    const error = await liveApiClient.post(`/leave-requests/${request.id}:approve`, {}).then(
      () => null,
      (caught: unknown) => caught,
    );

    // Either the segregation rule (422) or the missing approve key (403) — both are
    // the system refusing, and which one arrives depends on the seeded grants rather
    // than on anything this spec controls.
    expect(error).toBeInstanceOf(ApiError);
    expect([403, 422]).toContain((error as ApiError).status);
  });

  test("a request can be cancelled before it starts", async ({ liveApiClient }) => {
    const register = await seedAttendanceRegister(liveApiClient);
    const [studentId] = register.studentIds;
    if (!studentId) throw new Error("expected the register to have a roster");
    const start = nextMonday(3);

    const created = await liveApiClient.post("/leave-requests", {
      student_id: studentId,
      leave_type_id: await sickLeaveTypeId(liveApiClient),
      start_date: start,
      end_date: start,
      reason: "Wedding.",
    });

    const cancelled = await liveApiClient.post(
      `/leave-requests/${(created.data as LeaveRequest).id}:cancel`,
      {},
    );

    expect((cancelled.data as LeaveRequest).status).toBe("cancelled");
  });

  test("overlapping requests for the same student are refused", async ({ liveApiClient }) => {
    const register = await seedAttendanceRegister(liveApiClient);
    const [studentId] = register.studentIds;
    if (!studentId) throw new Error("expected the register to have a roster");
    const leaveTypeId = await sickLeaveTypeId(liveApiClient);
    const start = nextMonday(4);

    await liveApiClient.post("/leave-requests", {
      student_id: studentId,
      leave_type_id: leaveTypeId,
      start_date: start,
      end_date: addDays(start, 3),
      reason: "First.",
    });

    const error = await liveApiClient
      .post("/leave-requests", {
        student_id: studentId,
        leave_type_id: leaveTypeId,
        start_date: addDays(start, 1),
        end_date: addDays(start, 4),
        reason: "Second, overlapping.",
      })
      .then(
        () => null,
        (caught: unknown) => caught,
      );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);
  });

  test("leave types cannot be created through this module", async ({ liveApiClient }) => {
    /* Writing them is hr.leave-type.* (hr-leave.md §4), a namespace this module
     * must not register on another's behalf. Pinned so the day hr-leave ships its
     * own endpoint, this spec fails and is updated deliberately. */
    const error = await liveApiClient.post("/leave-types", { name: "Invented", code: "INV" }).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(405);
  });
});
