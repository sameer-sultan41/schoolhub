import { ApiError, type ApiClient, type ApiSchemas } from "@schoolhub/api-client";
import { env } from "@/env";
import { expect, test } from "@/fixtures";
import { createLiveSession } from "@/lib/live-api";
import { seedAttendanceRegister } from "@/lib/live-attendance-register";
import { linkSeededGuardian } from "@/lib/live-guardian";
import {
  E2E_COMMS_GUARDIAN_EMAIL,
  E2E_COMMS_STUDENT_ADMISSION_NUMBER,
  E2E_GUARDIAN_EMAIL,
  E2E_UNLINKED_STUDENT_ADMISSION_NUMBER,
} from "@/lib/seed-constants";

/**
 * Live API lane — no browser. See campuses.spec.ts's header for the shared rationale.
 *
 * What this lane proves that the Django suite cannot: that a real guardian login, through the
 * real storage and PostgreSQL under the NOSUPERUSER role, can run the portal's upload, leave and
 * voucher paths for their own child and for nobody else's. The upload is the real three steps
 * (`POST /files`, a PUT to the presigned URL, `:confirm`): a stub proves none of them.
 *
 * Two guardians, and the split is the point. The **comms guardian** (linked to the comms student
 * by the seed) is the caller. The **leave guardian** (`E2E_GUARDIAN_EMAIL`, linked here to a
 * run-unique student, as `attendance-leave.spec.ts` does) owns the request and the file the
 * comms guardian must not be able to reach. Leave types come from the seed (SICK requires an
 * attachment, CASUAL does not).
 *
 * Endpoints covered: `POST /files`, `POST /files/{id}:confirm`, `GET/POST /leave-requests`,
 * `GET /leave-requests/{id}`, `POST /leave-requests/{id}:cancel`,
 * `POST /leave-requests/{id}/attachment:download`, `GET /leave-types`,
 * `GET /vouchers`, `GET /vouchers/{id}/download`, read alongside `POST /fee-invoices/{id}/vouchers`.
 *
 * Logins: each guardian once per worker (`sessionFor`), per e2e/AGENTS.md's auth-throttle rule.
 */

type LeaveRequest = ApiSchemas["LeaveRequest"];
type LeaveType = ApiSchemas["LeaveType"];
type Voucher = ApiSchemas["FeeVoucher"];
type Invoice = ApiSchemas["FeeInvoice"];

interface UploadSlot {
  id: string;
  upload_url: string;
  upload_method: string;
  headers: Record<string, string>;
}

const LEAVE_ATTACHMENT = "attendance.leave-attachment";
const NOTE_TEXT = "%PDF-1.4 e2e medical note";

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

/** A Monday comfortably ahead: §6 refuses cancellation once leave has started. */
function nextMonday(weeksAhead: number): string {
  const date = new Date();
  const daysToMonday = (8 - date.getDay()) % 7 || 7;
  date.setDate(date.getDate() + daysToMonday + 7 * (weeksAhead - 1));
  return date.toISOString().slice(0, 10);
}

async function leaveTypeId(client: ApiClient, code: string): Promise<string> {
  const types = await client.get<LeaveType[]>("/leave-types", { query: { is_active: "true" } });
  const type = types.data.find((row) => row.code === code);
  if (!type) throw new Error(`expected the seeded ${code} leave type`);
  return type.id;
}

/** The portal's real upload: a slot, the bytes to storage, then the confirmation. */
async function uploadNote(client: ApiClient, name: string): Promise<string> {
  const bytes = new TextEncoder().encode(NOTE_TEXT);
  const slot = (
    await client.post<UploadSlot>("/files", {
      original_name: name,
      mime_type: "application/pdf",
      size_bytes: bytes.length,
      purpose: LEAVE_ATTACHMENT,
    })
  ).data;
  const stored = await fetch(slot.upload_url, {
    method: slot.upload_method,
    headers: slot.headers,
    body: bytes,
  });
  expect(stored.ok).toBe(true);
  await client.post(`/files/${slot.id}:confirm`);
  return slot.id;
}

/** What the request's signed attachment URL actually serves, fetched as storage serves it. */
async function attachmentText(client: ApiClient, requestId: string): Promise<string> {
  const signed = await client.post<{ download_url: string }>(
    `/leave-requests/${requestId}/attachment:download`,
  );
  const served = await fetch(signed.data.download_url);
  expect(served.ok).toBe(true);
  return served.text();
}

/** The field names a refusal points at. */
function refusedFields(error: unknown): string[] {
  expect(error).toBeInstanceOf(ApiError);
  return (error as ApiError).details.map((detail) => detail.field ?? "");
}

const refusal = (call: Promise<unknown>) =>
  call.then(
    () => null,
    (caught: unknown) => caught,
  );

test.describe("portal leave, uploads and vouchers (live API)", () => {
  test("a guardian uploads a note, submits leave for their child and cancels it", async ({
    liveApiClient,
  }) => {
    const child = await studentIdByAdmissionNumber(
      liveApiClient,
      E2E_COMMS_STUDENT_ADMISSION_NUMBER,
    );
    const guardian = await sessionFor(E2E_COMMS_GUARDIAN_EMAIL);
    const sick = await leaveTypeId(guardian, "SICK");
    const start = nextMonday(6);

    // SICK needs a document: without one the server says which field.
    const missing = await refusal(
      guardian.post("/leave-requests", {
        student_id: child,
        leave_type_id: sick,
        start_date: start,
        end_date: start,
        reason: "Fever.",
      }),
    );
    expect(refusedFields(missing)).toContain("attachment_file_id");

    const fileId = await uploadNote(guardian, "note.pdf");
    const created = (
      await guardian.post<LeaveRequest>("/leave-requests", {
        student_id: child,
        leave_type_id: sick,
        start_date: start,
        end_date: start,
        reason: "Fever.",
        attachment_file_id: fileId,
      })
    ).data;
    expect(created.status).toBe("pending");
    expect(created.attachment_file_id).toBe(fileId);

    const listed = await guardian.get<LeaveRequest[]>("/leave-requests", {
      query: { student_id: child },
    });
    expect(listed.data.map((row) => row.id)).toContain(created.id);

    // The guardian re-opens the note they sent, and an approver reads the same bytes: the
    // request's scope signs it, not a file key (`/files` never signs a leave attachment).
    expect(await attachmentText(guardian, created.id)).toBe(NOTE_TEXT);
    expect(await attachmentText(liveApiClient, created.id)).toBe(NOTE_TEXT);
    await expect(liveApiClient.post(`/files/${fileId}:download`)).rejects.toMatchObject({
      status: 404,
    });

    const cancelled = await guardian.post<LeaveRequest>(`/leave-requests/${created.id}:cancel`, {});
    expect(cancelled.data.status).toBe("cancelled");
  });

  test("another family's child, request and file are out of reach", async ({ liveApiClient }) => {
    const register = await seedAttendanceRegister(liveApiClient);
    const [otherChild] = register.studentIds;
    if (!otherChild) throw new Error("expected the register to have a roster");
    await linkSeededGuardian(liveApiClient, otherChild);
    const owner = await sessionFor(E2E_GUARDIAN_EMAIL);
    const caller = await sessionFor(E2E_COMMS_GUARDIAN_EMAIL);
    const casual = await leaveTypeId(caller, "CASUAL");
    const start = nextMonday(7);
    const ownersFile = await uploadNote(owner, "theirs.pdf");
    const ownersRequest = (
      await owner.post<LeaveRequest>("/leave-requests", {
        student_id: otherChild,
        leave_type_id: casual,
        start_date: start,
        end_date: start,
        reason: "Wedding.",
        attachment_file_id: ownersFile,
      })
    ).data;

    // Their request is a 404, never a 403 that would confirm it exists (ADR-0004).
    await expect(caller.get(`/leave-requests/${ownersRequest.id}`)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      caller.post(`/leave-requests/${ownersRequest.id}:cancel`, {}),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      caller.post(`/leave-requests/${ownersRequest.id}/attachment:download`),
    ).rejects.toMatchObject({ status: 404 });
    // Their child is the field the refusal names; the list shows the caller nothing of it.
    const forOther = await refusal(
      caller.post("/leave-requests", {
        student_id: otherChild,
        leave_type_id: casual,
        start_date: start,
        end_date: start,
        reason: "Not mine.",
      }),
    );
    expect(refusedFields(forOther)).toContain("student_id");
    const unlinked = await studentIdByAdmissionNumber(
      liveApiClient,
      E2E_UNLINKED_STUDENT_ADMISSION_NUMBER,
    );
    const theirs = await caller.get<LeaveRequest[]>("/leave-requests", {
      query: { student_id: unlinked },
    });
    expect(theirs.data).toHaveLength(0);

    // Their file cannot be attached to the caller's own child's request.
    const child = await studentIdByAdmissionNumber(
      liveApiClient,
      E2E_COMMS_STUDENT_ADMISSION_NUMBER,
    );
    const withTheirFile = await refusal(
      caller.post("/leave-requests", {
        student_id: child,
        leave_type_id: await leaveTypeId(caller, "SICK"),
        start_date: nextMonday(8),
        end_date: nextMonday(8),
        reason: "Fever.",
        attachment_file_id: ownersFile,
      }),
    );
    expect(refusedFields(withTheirFile)).toContain("attachment_file_id");

    await owner.post(`/leave-requests/${ownersRequest.id}:cancel`, {});
  });

  test("a guardian cannot ask for an upload purpose the portal does not offer", async () => {
    const guardian = await sessionFor(E2E_COMMS_GUARDIAN_EMAIL);

    const refused = await refusal(
      guardian.post("/files", {
        original_name: "photo.png",
        mime_type: "image/png",
        size_bytes: 10,
        purpose: "student.photo",
      }),
    );

    expect(refusedFields(refused)).toContain("purpose");
  });

  test("a guardian lists and downloads the voucher of their own child's invoice", async ({
    liveApiClient,
  }) => {
    const child = await studentIdByAdmissionNumber(
      liveApiClient,
      E2E_COMMS_STUDENT_ADMISSION_NUMBER,
    );
    const guardian = await sessionFor(E2E_COMMS_GUARDIAN_EMAIL);
    const invoices = await guardian.get<Invoice[]>("/fee-invoices", {
      query: { student: child, outstanding: "true", page_size: 100 },
    });
    const invoice = invoices.data[0];
    if (!invoice) throw new Error("the comms child has no outstanding invoice — run the seed");

    // The school issues the slip; the guardian only reads it.
    const issued = (
      await liveApiClient.post<Voucher>(`/fee-invoices/${invoice.id}/vouchers`, {
        provider: "bank_branch",
      })
    ).data;

    const listed = await guardian.get<Voucher[]>("/vouchers", {
      query: { student: child, status: "issued", page_size: 100 },
    });
    const mine = listed.data.find((row) => row.id === issued.id);
    expect(mine?.fee_invoice).toBe(invoice.id);
    expect(listed.data.every((row) => row.student === child)).toBe(true);

    const pdf = await guardian.downloadBlob(`/vouchers/${issued.id}/download`, {
      query: { format: "pdf" },
    });
    expect(pdf.size).toBeGreaterThan(0);
  });
});
