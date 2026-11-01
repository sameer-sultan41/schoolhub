import type { ApiSchemas } from "@schoolhub/api-client";
import type { AuthenticatedUser, PermissionKey } from "@schoolhub/types";
import { uuid } from "@/data/factories";
import type { FileDownloadStub, JobsOptions, JobStub } from "./jobs";

/**
 * The server's state behind `communicationModule` (`./communication`): the caller's threads and
 * their messages, the audience a broadcast resolves to right now, and the jobs a send leaves for
 * `jobsModule` to serve. Threads are seeded as the caller's inbox would return them; the stub
 * does not re-derive participation, only the rules `threads/services/` and `dispatch.py` apply.
 */

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** The generated shapes, writable here because this stub plays the server. */
export type ThreadRecord = Mutable<ApiSchemas["MessageThread"]>;
export type MessageRow = Mutable<ApiSchemas["Message"]>;
export type BroadcastSendBody = ApiSchemas["BroadcastSend"];

/** The sentences the thread services and `dispatch.py` send, copied verbatim (L5). */
export const COMMUNICATION_MESSAGES = {
  noSuchThread: "No such thread.",
  alreadyClosed: "This thread is already closed.",
  alreadyOpen: "This thread is already open.",
  reopenToReply: "Reopen the thread to reply.",
  audienceChanged:
    "The audience changed since the preview. Check the new recipient count and confirm again.",
} as const;

/** The code `AudienceChanged` carries; it is not in the shared `ApiErrorCode` list. */
export const AUDIENCE_CHANGED_CODE = "audience_changed";

const SENT_AT = "2026-10-30T09:00:00Z";

export function buildThread(overrides: Partial<ThreadRecord> = {}): ThreadRecord {
  return {
    id: uuid(),
    subject: "Fee reminder",
    thread_type: "guardian_school",
    student_id: null,
    participant_user_ids: [],
    assigned_to_id: null,
    status: "open",
    last_message_at: SENT_AT,
    closed_at: null,
    created_by: null,
    created_at: SENT_AT,
    unread_count: 0,
    ...overrides,
  };
}

export function buildMessage(threadId: string, overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: uuid(),
    thread_id: threadId,
    sender_id: uuid(),
    body: "Hello",
    attachments: null,
    is_internal_note: false,
    read_by: null,
    sent_at: SENT_AT,
    ...overrides,
  };
}

/** One call to `POST /broadcasts:emergency`: the body and the `Idempotency-Key` it carried. */
export interface BroadcastSend {
  key: string | undefined;
  body: BroadcastSendBody;
}

export interface CommunicationOptions {
  /** The signed-in caller: their permission keys decide what the server allows. */
  user: AuthenticatedUser;
  threads?: ThreadRecord[];
  /** Each thread's messages, oldest first, by thread id. */
  messages?: Record<string, MessageRow[]>;
  /** The recipients the audience resolves to right now, and the digest of that set. */
  recipientCount?: number;
  audienceDigest?: string;
  channels?: string[];
  unavailableChannels?: string[];
}

export class CommunicationStore {
  readonly user: AuthenticatedUser;
  readonly threads: ThreadRecord[];
  readonly messages: Record<string, MessageRow[]>;
  recipientCount: number;
  audienceDigest: string;
  readonly channels: string[];
  readonly unavailableChannels: string[];
  /** `jobsModule`'s poll sequences and files, shared by reference: a job queued here is served
   * there. Pass `jobsOptions()` to `jobsModule`. */
  readonly jobs: Record<string, JobStub[]> = {};
  readonly files: FileDownloadStub[] = [];
  /** Thread ids `:mark-read` was called for, in order. */
  readonly markedRead: string[] = [];
  readonly sends: BroadcastSend[] = [];
  readonly previews: ApiSchemas["BroadcastRequest"][] = [];

  constructor(options: CommunicationOptions) {
    this.user = options.user;
    this.threads = [...(options.threads ?? [])];
    this.messages = Object.fromEntries(
      Object.entries(options.messages ?? {}).map(([id, rows]) => [id, [...rows]]),
    );
    this.recipientCount = options.recipientCount ?? 0;
    this.audienceDigest = options.audienceDigest ?? "digest-0";
    this.channels = options.channels ?? ["in_app"];
    this.unavailableChannels = options.unavailableChannels ?? [];
  }

  jobsOptions(): JobsOptions {
    return { jobs: this.jobs, files: this.files };
  }

  holds(...keys: PermissionKey[]): boolean {
    return keys.some((key) => this.user.permissions.includes(key));
  }

  thread(threadId: string): ThreadRecord | undefined {
    return this.threads.find((candidate) => candidate.id === threadId);
  }

  messagesOf(threadId: string): MessageRow[] {
    return this.messages[threadId] ?? [];
  }

  /** `unread_count`: the messages of others the caller has not stamped as read. */
  unreadCount(threadId: string): number {
    return this.messagesOf(threadId).filter(
      (message) => message.sender_id !== this.user.id && !message.read_by?.[this.user.id],
    ).length;
  }

  /** `mark_thread_read`: stamps every unread message and answers how many it stamped. */
  markRead(threadId: string): number {
    const unread = this.messagesOf(threadId).filter(
      (message) => message.sender_id !== this.user.id && !message.read_by?.[this.user.id],
    );
    const stamp = new Date().toISOString();
    for (const message of unread) {
      message.read_by = { ...message.read_by, [this.user.id]: stamp };
    }
    this.markedRead.push(threadId);
    return unread.length;
  }

  /** A thread as the inbox serializes it, with the caller's live `unread_count`. */
  serialize(thread: ThreadRecord): ThreadRecord {
    return { ...thread, unread_count: this.unreadCount(thread.id) };
  }

  /** `post_message`: a closed thread takes no reply; a new message moves the thread's activity. */
  post(thread: ThreadRecord, body: string, isInternalNote: boolean): MessageRow {
    const sentAt = new Date().toISOString();
    const message = buildMessage(thread.id, {
      sender_id: this.user.id,
      body,
      is_internal_note: isInternalNote,
      read_by: { [this.user.id]: sentAt },
      sent_at: sentAt,
    });
    this.messages[thread.id] = [...this.messagesOf(thread.id), message];
    thread.last_message_at = sentAt;
    return message;
  }
}
