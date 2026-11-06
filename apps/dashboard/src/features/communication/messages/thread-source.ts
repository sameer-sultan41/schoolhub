import type { Page } from "@schoolhub/types";

import { Services } from "@/services";
import { MESSAGE_THREADS_QUERY_MODULE } from "@/services/modules/message-threads/message-threads-constant";
import type {
  AttachmentDownload,
  MessageRecord,
  MessagesQuery,
  MessageThreadStatus,
} from "@/services/modules/message-threads/message-threads-type";
import { THREAD_OVERSIGHT_QUERY_MODULE } from "@/services/modules/thread-oversight/thread-oversight-constant";
import type { ThreadOversightRecord } from "@/services/modules/thread-oversight/thread-oversight-type";

/** A row of either list: the inbox's carries the caller's `unread_count`, oversight's has none. */
export type ThreadRow = ThreadOversightRecord & { readonly unread_count?: number };

export interface ThreadListQuery {
  status?: MessageThreadStatus;
  cursor?: string;
  pageSize?: number;
}

/**
 * Where a thread screen reads from: the caller's inbox, or the read-only oversight twin. The
 * list, the thread view and the message list take one, so oversight reuses them unchanged.
 */
export interface ThreadSource {
  /** The query-key module its reads live under. */
  module: string;
  listThreads: (query: ThreadListQuery) => Promise<Page<ThreadRow>>;
  fetchThread: (threadId: string) => Promise<ThreadRow>;
  listMessages: (threadId: string, query: MessagesQuery) => Promise<Page<MessageRecord>>;
  downloadAttachment: (threadId: string, fileId: string) => Promise<AttachmentDownload>;
}

export const INBOX_SOURCE: ThreadSource = {
  module: MESSAGE_THREADS_QUERY_MODULE,
  listThreads: (query) => Services.messageThreads.listThreads(query),
  fetchThread: (threadId) => Services.messageThreads.fetchThread(threadId),
  listMessages: (threadId, query) => Services.messageThreads.listMessages(threadId, query),
  downloadAttachment: (threadId, fileId) =>
    Services.messageThreads.downloadAttachment(threadId, fileId),
};

export const OVERSIGHT_SOURCE: ThreadSource = {
  module: THREAD_OVERSIGHT_QUERY_MODULE,
  listThreads: (query) => Services.threadOversight.listThreads(query),
  fetchThread: (threadId) => Services.threadOversight.fetchThread(threadId),
  listMessages: (threadId, query) => Services.threadOversight.listMessages(threadId, query),
  downloadAttachment: (threadId, fileId) =>
    Services.threadOversight.downloadAttachment(threadId, fileId),
};
