import type { ApiSchemas } from "@schoolhub/api-client";
import { uuid } from "@/data/factories";
import { fail, harnessError, ok, type MockResponse } from "../envelope";
import { cursorPageOf } from "../list";
import type { MockModule } from "../router";
import { PERMISSION_DENIED } from "./attendance-approvals";
import { colonAction, fieldErrors, REQUIRED } from "./attendance-mock-utils";
import {
  AUDIENCE_CHANGED_CODE,
  COMMUNICATION_MESSAGES,
  type BroadcastSendBody,
  type CommunicationStore,
  type ThreadRecord,
} from "./communication-store";

interface MessageBody {
  body?: string;
  is_internal_note?: boolean;
}

/** `ThreadOversightSerializer`: the inbox row without the caller's `unread_count`. */
function toOversight(thread: ThreadRecord): ApiSchemas["ThreadOversight"] {
  return {
    id: thread.id,
    subject: thread.subject,
    thread_type: thread.thread_type,
    student_id: thread.student_id,
    participant_user_ids: thread.participant_user_ids,
    assigned_to_id: thread.assigned_to_id,
    status: thread.status,
    last_message_at: thread.last_message_at,
    closed_at: thread.closed_at,
    created_by: thread.created_by,
    created_at: thread.created_at,
  };
}

/** `AudienceChanged`: the 409 envelope, with the current count and digest in `error.meta`. */
function audienceChanged(recipientCount: number, audienceDigest: string): MockResponse {
  const refused = fail(409, COMMUNICATION_MESSAGES.audienceChanged, {
    code: AUDIENCE_CHANGED_CODE,
  });
  return {
    ...refused,
    body: {
      error: {
        ...refused.body.error,
        meta: { recipient_count: recipientCount, audience_digest: audienceDigest },
      },
    },
  };
}

/** Newest activity first, as the inbox and oversight lists order their threads. */
function byActivity(a: ThreadRecord, b: ThreadRecord): number {
  return b.last_message_at.localeCompare(a.last_message_at);
}

/**
 * `/message-threads` (the inbox, a thread, its messages, `:mark-read`, `:close`, `:reopen`),
 * `/message-thread-oversight` (the read-only twin), and `POST /broadcasts:preview` and
 * `:emergency`, for the caller in `store.user`.
 *
 * Each route checks its permission key first (403), then the thread (404), then the service's
 * rules in the service's order with its sentences (L5). A send is compared with the audience as
 * it stands in the store (`recipientCount`, `audienceDigest`), so a spec that changes them
 * between the preview and the send gets the real 409. An accepted send queues a job for
 * `jobsModule` (register it with `store.jobsOptions()`). Message lists are cursor paged,
 * newest first.
 *
 * Thread creation, recipient search and an attachment's download are not stubbed: no spec here
 * drives them.
 */
export function communicationModule(store: CommunicationStore): MockModule {
  const forbidden = (): MockResponse => fail(403, PERMISSION_DENIED);
  const noThread = (): MockResponse => fail(404, COMMUNICATION_MESSAGES.noSuchThread);
  const lacks = (...keys: Parameters<CommunicationStore["holds"]>) => !store.holds(...keys);

  return (api) => {
    // ---- the caller's inbox ------------------------------------------------------------
    api.get("/message-threads", (request) => {
      if (lacks("communication.thread.view")) return forbidden();
      const status = request.searchParams.get("status");
      const rows = store.threads
        .filter((thread) => !status || thread.status === status)
        .sort(byActivity)
        .map((thread) => store.serialize(thread));
      return cursorPageOf(rows, request.searchParams);
    });

    api.get("/message-threads/:threadId", (request) => {
      if (lacks("communication.thread.view")) return forbidden();
      const thread = store.thread(request.params["threadId"] ?? "");
      return thread ? ok(store.serialize(thread)) : noThread();
    });

    api.get("/message-threads/:threadId/messages", (request) => {
      if (lacks("communication.thread.view")) return forbidden();
      const threadId = request.params["threadId"] ?? "";
      if (!store.thread(threadId)) return noThread();
      return cursorPageOf([...store.messagesOf(threadId)].reverse(), request.searchParams);
    });

    api.post("/message-threads/:threadId/messages", (request) => {
      if (lacks("communication.message.create")) return forbidden();
      const thread = store.thread(request.params["threadId"] ?? "");
      if (!thread) return noThread();
      const body = (request.json() as MessageBody | null) ?? {};
      if (!body.body?.trim()) return fieldErrors([{ field: "body", issue: REQUIRED }]);
      if (thread.status === "closed") return fail(409, COMMUNICATION_MESSAGES.reopenToReply);
      const message = store.post(thread, body.body, body.is_internal_note ?? false);
      return ok(message, { status: 201 });
    });

    // `:mark-read`, `:close` and `:reopen` are colon-actions on one thread.
    api.post("/message-threads/:threadAction", (request) => {
      const { id, action } = colonAction(request.params["threadAction"]);
      const thread = store.thread(id);
      if (action === "mark-read") {
        if (lacks("communication.message.create")) return forbidden();
        if (!thread) return noThread();
        return ok({ marked: store.markRead(id) });
      }
      if (action !== "close" && action !== "reopen") {
        return harnessError(`No mock for message-threads :${action ?? ""}`);
      }
      if (lacks("communication.thread.close")) return forbidden();
      if (!thread) return noThread();
      if (action === "close") {
        if (thread.status === "closed") return fail(409, COMMUNICATION_MESSAGES.alreadyClosed);
        thread.status = "closed";
        thread.closed_at = new Date().toISOString();
        return ok(store.serialize(thread), { meta: { message: "Thread closed." } });
      }
      if (thread.status === "open") return fail(409, COMMUNICATION_MESSAGES.alreadyOpen);
      thread.status = "open";
      thread.closed_at = null;
      return ok(store.serialize(thread), { meta: { message: "Thread reopened." } });
    });

    // ---- oversight: every thread in the school, read-only -------------------------------
    api.get("/message-thread-oversight", (request) => {
      if (lacks("communication.thread.oversee")) return forbidden();
      const status = request.searchParams.get("status");
      const rows = store.threads
        .filter((thread) => !status || thread.status === status)
        .sort(byActivity)
        .map(toOversight);
      return cursorPageOf(rows, request.searchParams);
    });

    api.get("/message-thread-oversight/:threadId", (request) => {
      if (lacks("communication.thread.oversee")) return forbidden();
      const thread = store.thread(request.params["threadId"] ?? "");
      return thread ? ok(toOversight(thread)) : noThread();
    });

    api.get("/message-thread-oversight/:threadId/messages", (request) => {
      if (lacks("communication.thread.oversee")) return forbidden();
      const threadId = request.params["threadId"] ?? "";
      if (!store.thread(threadId)) return noThread();
      return cursorPageOf([...store.messagesOf(threadId)].reverse(), request.searchParams);
    });

    // ---- broadcasts ---------------------------------------------------------------------
    // The router reads `:name` as a parameter, so `/broadcasts:action` compiles to
    // `/broadcasts([^/]+)` and takes both colon-actions: `action` is ":preview" or ":emergency".
    api.post("/broadcasts:action", (request) => {
      const action = (request.params["action"] ?? "").replace(/^:/, "");
      if (action !== "preview" && action !== "emergency") {
        return harnessError(`No mock for broadcasts:${action}`);
      }
      if (lacks("communication.broadcast.send")) return forbidden();

      if (action === "preview") {
        const requested = request.json() as ApiSchemas["BroadcastRequest"] | null;
        if (requested) store.previews.push(requested);
        return ok({
          recipient_count: store.recipientCount,
          audience_digest: store.audienceDigest,
          channels: store.channels,
          unavailable_channels: store.unavailableChannels,
        });
      }

      const body = request.json() as BroadcastSendBody | null;
      if (!body) return fieldErrors([{ field: "audience_type", issue: REQUIRED }]);
      store.sends.push({ key: request.headers["idempotency-key"], body });
      // `dispatch_emergency_broadcast`: resolve, compare, and only then queue; a 409 is raised,
      // never stored, so a retry with the same key re-checks the audience.
      if (
        body.confirm_recipient_count !== store.recipientCount ||
        body.audience_digest !== store.audienceDigest
      ) {
        return audienceChanged(store.recipientCount, store.audienceDigest);
      }
      const jobId = uuid();
      store.jobs[jobId] = [
        { status: "succeeded", progress: 100, result: { recipient_count: store.recipientCount } },
      ];
      return ok(
        { job_id: jobId, status: "queued" },
        { status: 202, meta: { message: "Emergency broadcast queued." } },
      );
    });
  };
}
