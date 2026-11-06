import { ApiError, collectPages, type ApiClient, type ApiSchemas } from "@schoolhub/api-client";
import { buildLiveBroadcastMessage, buildLiveThread } from "@/data/live-factories";
import { env } from "@/env";
import { expect, test } from "@/fixtures";
import { createLiveSession } from "@/lib/live-api";
import { awaitJob } from "@/lib/live-jobs";
import {
  E2E_COMMS_CLASS_TEACHER_EMAIL,
  E2E_COMMS_GUARDIAN_EMAIL,
  E2E_COMMS_STUDENT_ADMISSION_NUMBER,
  E2E_PRINCIPAL_EMAIL,
} from "@/lib/seed-constants";

/**
 * Live API lane — no browser. See campuses.spec.ts's header for the shared rationale.
 *
 * What this lane proves that the Django suite cannot: that a guardian's thread is routed,
 * read, answered and overseen through real PostgreSQL under the NOSUPERUSER role (the
 * GIN-served participant filter and RLS on `message_threads`/`messages`), and that an
 * emergency broadcast fans out in a real Celery worker on the `emergency` queue.
 *
 * The thread runs on seed_e2e_data.py's communication fixture: the comms guardian is
 * linked to the comms student, who is enrolled in the baseline section, whose class
 * teacher is the `assigned`-scoped comms class teacher. So the thread is routed to that
 * teacher, and the teacher reaches it through membership, not record scope (ADR-0030).
 *
 * "The guardian was notified" is read where the server records each channel's delivery:
 * `/delivery-logs`, as the seeded owner. (The recipient's own `GET /notifications` inbox is
 * covered by parent-portal.spec.ts.) Every notification gets one row
 * per channel. A push row carries the rendered subject and body (push has no adapter yet,
 * so it is `skipped`, but it is written), and the in-app row of the same notification
 * carries the recipient's masked user id.
 *
 * Endpoints covered: `POST/GET /message-threads`, `GET /message-threads/{id}`,
 * `GET/POST /message-threads/{id}/messages`, `POST /message-threads/{id}:mark-read`,
 * `GET /message-thread-oversight/{id}` and its `/messages`, `POST /broadcasts:preview`,
 * `POST /broadcasts:emergency` (409, 202, and an `Idempotency-Key` replay),
 * `GET /jobs/{id}` and `GET /delivery-logs`.
 *
 * Logins: the comms guardian, the comms class teacher and the principal, each once per
 * worker (`sessionFor`); the owner and the other tenant's owner are the shared fixtures.
 */

type Thread = ApiSchemas["MessageThread"];
type Message = ApiSchemas["Message"];
type OverseenThread = ApiSchemas["ThreadOversight"];
type MarkReadResult = ApiSchemas["MarkReadResult"];
type BroadcastPreview = ApiSchemas["BroadcastPreview"];
type BroadcastQueued = ApiSchemas["BroadcastQueued"];
type DeliveryLog = ApiSchemas["DeliveryLog"];
type User = ApiSchemas["User"];

/** apps/communication/notifications.py's trigger keys, which are also the template codes. */
const THREAD_REPLY = "communication.thread-reply";
const EMERGENCY_BROADCAST = "communication.emergency-broadcast";

/** The five channels `communication.emergency-broadcast` declares (communication.md §12). */
const BROADCAST_CHANNELS = ["email", "in_app", "push", "sms", "whatsapp"];

const logins = new Map<string, Promise<ApiClient>>();

/**
 * One login per identity per worker, not per test: the same pattern as
 * `attendance-leave.spec.ts`'s `guardianSession`, so the auth throttle (e2e/AGENTS.md) is
 * spent once.
 */
function sessionFor(identifier: string): Promise<ApiClient> {
  let login = logins.get(identifier);
  if (!login) {
    login = createLiveSession({ identifier, password: env.LIVE_ADMIN_PASSWORD });
    logins.set(identifier, login);
  }
  return login;
}

async function commsStudentId(admin: ApiClient): Promise<string> {
  const listed = await admin.get<{ id: string; admission_number: string }[]>("/students", {
    query: { search: E2E_COMMS_STUDENT_ADMISSION_NUMBER },
  });
  const student = listed.data.find(
    (row) => row.admission_number === E2E_COMMS_STUDENT_ADMISSION_NUMBER,
  );
  if (!student) throw new Error("the comms student is missing — run manage.py seed_e2e_data");
  return student.id;
}

/** `core/notifications/services.py::mask_address` for a user id: all but the last four hidden. */
function maskedUserId(userId: string): string {
  return `${"*".repeat(userId.length - 4)}${userId.slice(-4)}`;
}

/** sha256 hex, as `broadcasts/services/preview.py::audience_digest` computes it. */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A trigger's push rows written since `since` (server time), as the owner reads them. */
async function pushDeliveries(
  admin: ApiClient,
  templateCode: string,
  since: string,
): Promise<DeliveryLog[]> {
  const rows = await collectPages<DeliveryLog>(admin, "/delivery-logs", {
    query: { channel: "push", created_at__gte: since, page_size: 100 },
    maxPages: 10,
  });
  return rows.filter((row) => row.template_code === templateCode);
}

/** Who a notification went to: its in-app row's masked user id. */
async function recipientOf(admin: ApiClient, notificationId: string): Promise<string> {
  const rows = await admin.get<DeliveryLog[]>("/delivery-logs", {
    query: { notification_id: notificationId, channel: "in_app" },
  });
  const [inApp] = rows.data;
  if (!inApp) throw new Error(`notification ${notificationId} has no in-app delivery row`);
  return inApp.recipient_address;
}

test.describe("communication threads (live API)", () => {
  test("a guardian's thread reaches the assigned class teacher, and the principal oversees it", async ({
    liveApiClient,
    liveOtherTenantApiClient,
  }) => {
    const studentId = await commsStudentId(liveApiClient);
    const guardian = await sessionFor(E2E_COMMS_GUARDIAN_EMAIL);
    const teacher = await sessionFor(E2E_COMMS_CLASS_TEACHER_EMAIL);
    const teacherId = (await teacher.get<User>("/auth/me")).data.id;

    // The guardian names the child, not the staff member: routing picks the class teacher.
    const opening = buildLiveThread(studentId);
    const thread = (await guardian.post<Thread>("/message-threads", opening)).data;
    const guardianId = thread.created_by;
    if (!guardianId) throw new Error("a thread records who started it");
    expect(thread).toMatchObject({
      subject: opening.subject,
      thread_type: "guardian_school",
      status: "open",
      student_id: studentId,
      assigned_to_id: teacherId,
    });
    expect([...thread.participant_user_ids].sort()).toEqual([guardianId, teacherId].sort());

    // An `assigned`-scope class teacher sees it in their inbox, with the opening unread.
    const inbox = await teacher.get<Thread[]>("/message-threads", {
      query: { student_id: studentId, page_size: 100 },
    });
    expect(inbox.data.find((row) => row.id === thread.id)?.unread_count).toBe(1);

    const replyBody = `Yes, it is still on. (${opening.subject})`;
    const reply = (
      await teacher.post<Message>(`/message-threads/${thread.id}/messages`, { body: replyBody })
    ).data;
    const note = (
      await teacher.post<Message>(`/message-threads/${thread.id}/messages`, {
        body: "Staff only: check the consent forms first.",
        is_internal_note: true,
      })
    ).data;
    expect(note.is_internal_note).toBe(true);

    // The guardian reads the reply but never the internal note, and only the reply is unread.
    const guardianView = await guardian.get<Message[]>(`/message-threads/${thread.id}/messages`);
    const seen = guardianView.data.map((message) => message.id);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(reply.id);
    expect(seen).not.toContain(note.id);
    expect((await guardian.get<Thread>(`/message-threads/${thread.id}`)).data.unread_count).toBe(1);
    const marked = await guardian.post<MarkReadResult>(
      `/message-threads/${thread.id}:mark-read`,
      {},
    );
    expect(marked.data.marked).toBe(1);
    expect((await guardian.get<Thread>(`/message-threads/${thread.id}`)).data.unread_count).toBe(0);

    // One notification per message the other side can read: the opening to the teacher, the
    // reply to the guardian. The internal note notified nobody: its only other reader would
    // be the guardian, who never sees it.
    const pushes = (await pushDeliveries(liveApiClient, THREAD_REPLY, thread.created_at)).filter(
      (row) => row.subject === opening.subject,
    );
    expect(pushes).toHaveLength(2);
    const replyPush = pushes.find((row) => row.body?.endsWith(`: ${replyBody}`));
    const openingPush = pushes.find((row) => row.body?.endsWith(`: ${opening.body}`));
    if (!replyPush || !openingPush) {
      throw new Error(`unexpected push bodies: ${pushes.map((row) => row.body).join(" | ")}`);
    }
    expect(await recipientOf(liveApiClient, replyPush.notification)).toBe(maskedUserId(guardianId));
    expect(await recipientOf(liveApiClient, openingPush.notification)).toBe(
      maskedUserId(teacherId),
    );

    // The principal is no participant: the inbox 404s, and oversight shows the whole
    // conversation, internal note included.
    const principal = await sessionFor(E2E_PRINCIPAL_EMAIL);
    await expect(principal.get(`/message-threads/${thread.id}`)).rejects.toMatchObject({
      status: 404,
    });
    const overseen = await principal.get<OverseenThread>(`/message-thread-oversight/${thread.id}`);
    expect(overseen.data).toMatchObject({ id: thread.id, assigned_to_id: teacherId });
    const conversation = await principal.get<Message[]>(
      `/message-thread-oversight/${thread.id}/messages`,
    );
    expect(conversation.data.map((message) => message.id)).toHaveLength(3);
    expect(conversation.data.find((message) => message.id === note.id)?.is_internal_note).toBe(
      true,
    );
    // Reading it stamped nothing: the overseer is never a participant.
    const principalId = (await principal.get<User>("/auth/me")).data.id;
    for (const message of conversation.data) {
      expect(Object.keys(message.read_by ?? {})).not.toContain(principalId);
    }

    // The other school's owner holds `thread.oversee` too, and still finds nothing.
    await expect(
      liveOtherTenantApiClient.get(`/message-thread-oversight/${thread.id}`),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      liveOtherTenantApiClient.get(`/message-thread-oversight/${thread.id}/messages`),
    ).rejects.toMatchObject({ status: 404 });
  });
});

test.describe("emergency broadcast (live API)", () => {
  test("a broadcast is previewed, refused on a tampered digest, then sent once as a job", async ({
    liveApiClient,
  }) => {
    const principal = await sessionFor(E2E_PRINCIPAL_EMAIL);
    const guardian = await sessionFor(E2E_COMMS_GUARDIAN_EMAIL);
    const guardianId = (await guardian.get<User>("/auth/me")).data.id;
    // A custom audience of one: the count and digest stay fixed whatever else runs in parallel.
    const request = {
      audience_type: "custom",
      audience_filter: { user_ids: [guardianId] },
      message: buildLiveBroadcastMessage(),
    };

    const preview = (await principal.post<BroadcastPreview>("/broadcasts:preview", request)).data;
    expect(preview.recipient_count).toBe(1);
    expect(preview.audience_digest).toBe(await sha256Hex(guardianId));
    expect(preview.channels).toContain("in_app");
    expect([...preview.channels, ...preview.unavailable_channels].sort()).toEqual(
      BROADCAST_CHANNELS,
    );

    // A digest the preview never gave is refused, and the error carries the current values.
    const refused = await principal
      .post(
        "/broadcasts:emergency",
        { ...request, confirm_recipient_count: 1, audience_digest: "0".repeat(64) },
        { idempotencyKey: crypto.randomUUID() },
      )
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect(refused).toBeInstanceOf(ApiError);
    expect(refused).toMatchObject({
      status: 409,
      code: "audience_changed",
      meta: { recipient_count: 1, audience_digest: preview.audience_digest },
    });

    // The preview repeated back: queued as a job. A double click replays the same job.
    const confirmed = {
      ...request,
      confirm_recipient_count: preview.recipient_count,
      audience_digest: preview.audience_digest,
    };
    const idempotencyKey = crypto.randomUUID();
    const queued = await principal.post<BroadcastQueued>("/broadcasts:emergency", confirmed, {
      idempotencyKey,
    });
    expect(queued.status).toBe(202);
    const replayed = await principal.post<BroadcastQueued>("/broadcasts:emergency", confirmed, {
      idempotencyKey,
    });
    expect(replayed.data.job_id).toBe(queued.data.job_id);

    const job = await awaitJob<{ recipient_count: number; notification_count: number }>(
      principal,
      queued.data.job_id,
    );
    expect(job.status, `job ${job.id} failed: ${job.error ?? "no error recorded"}`).toBe(
      "succeeded",
    );
    expect(job.result).toEqual({ recipient_count: 1, notification_count: 1 });

    // One notification, to the guardian, with the message as sent.
    const pushes = (
      await pushDeliveries(liveApiClient, EMERGENCY_BROADCAST, job.created_at)
    ).filter((row) => row.body === request.message);
    expect(pushes).toHaveLength(1);
    const [push] = pushes;
    if (!push) throw new Error("expected the broadcast's push row");
    expect(await recipientOf(liveApiClient, push.notification)).toBe(maskedUserId(guardianId));
  });
});
