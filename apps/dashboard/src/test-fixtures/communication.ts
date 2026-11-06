import type { Page } from "@schoolhub/types";

import type { StudentRecord } from "@/services";
import type {
  MessageRecord,
  MessageThreadRecord,
} from "@/services/modules/message-threads/message-threads-type";
import type { ThreadOversightRecord } from "@/services/modules/thread-oversight/thread-oversight-type";
import { servicesMock } from "@/test-fixtures/services-mock";

/** The Communication screens' fixtures: both the inbox and oversight tests read them. */

export const THREAD_ID = "11111111-1111-4111-8111-111111111111";
export const OTHER_THREAD_ID = "22222222-2222-4222-8222-222222222222";
export const FILE_ID = "33333333-3333-4333-8333-333333333333";
export const STUDENT_ID = "44444444-4444-4444-8444-444444444444";
export const COLLEAGUE_ID = "55555555-5555-4555-8555-555555555555";
export const OTHER_COLLEAGUE_ID = "66666666-6666-4666-8666-666666666666";
/** The signed-in user's id: `buildUser`'s. */
export const ME = "user-1";
export const SOMEONE_ELSE = "77777777-7777-4777-8777-777777777777";
export const SIGNED_URL = "https://files.example.test/signed/fee-statement.pdf";

export function threadRecord(overrides: Partial<MessageThreadRecord> = {}): MessageThreadRecord {
  return {
    id: THREAD_ID,
    subject: "Fee query",
    thread_type: "guardian_school",
    student_id: STUDENT_ID,
    participant_user_ids: [ME, SOMEONE_ELSE],
    assigned_to_id: null,
    status: "open",
    last_message_at: "2026-10-30T09:00:00Z",
    closed_at: null,
    created_by: SOMEONE_ELSE,
    created_at: "2026-10-29T09:00:00Z",
    unread_count: 0,
    ...overrides,
  };
}

export function oversightRecord(
  overrides: Partial<ThreadOversightRecord> = {},
): ThreadOversightRecord {
  const { unread_count: _unread, ...record } = threadRecord();
  return { ...record, ...overrides };
}

export function messageRecord(overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    thread_id: THREAD_ID,
    sender_id: SOMEONE_ELSE,
    body: "Hello",
    attachments: null,
    is_internal_note: false,
    read_by: null,
    sent_at: "2026-10-30T09:00:00Z",
    ...overrides,
  };
}

export function studentRecord(overrides: Partial<StudentRecord> = {}): StudentRecord {
  return {
    id: STUDENT_ID,
    first_name: "Ayesha",
    last_name: "Khan",
    admission_number: "ADM-1042",
    ...overrides,
  } as StudentRecord;
}

/** One cursor page, as the thread and message reads return it. */
export function cursorPage<T>(items: T[], next: string | null = null): Page<T> {
  return { items, pagination: { next_cursor: next, previous_cursor: null, page_size: 20 } };
}

/** The `@/services` mock the Communication tests share (see `servicesMock`). */
export function communicationServicesMock() {
  return servicesMock({
    auth: ["fetchCurrentUser"],
    messageThreads: [
      "listThreads",
      "fetchThread",
      "createThread",
      "listMessages",
      "postMessage",
      "markRead",
      "closeThread",
      "reopenThread",
      "searchRecipients",
      "downloadAttachment",
    ],
    threadOversight: ["listThreads", "fetchThread", "listMessages", "downloadAttachment"],
    students: ["fetchStudentsPage"],
  });
}
