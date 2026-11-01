import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toMessagesQueryParams, toThreadsQueryParams } from "./message-threads-helper";
import type {
  AttachmentDownload,
  MarkReadResult,
  MessageCreateBody,
  MessageRecord,
  MessagesQuery,
  MessageThreadCreateBody,
  MessageThreadRecord,
  MessageThreadsQuery,
  ThreadRecipient,
} from "./message-threads-type";

/**
 * The message-threads domain's API calls (`/message-threads`). Every consumer reaches these
 * through `Services.messageThreads.*` (see `@/services`).
 */

/** One page of the caller's own inbox, newest activity first. */
export async function listThreads(query: MessageThreadsQuery): Promise<Page<MessageThreadRecord>> {
  return fetchPage<MessageThreadRecord>(apiClient, endpoints.messageThreads.list, {
    query: toThreadsQueryParams(query),
  });
}

/** One thread of the caller's inbox. */
export async function fetchThread(threadId: string): Promise<MessageThreadRecord> {
  const { data } = await apiClient.get<MessageThreadRecord>(
    endpoints.messageThreads.detail(threadId),
  );
  return data;
}

/** Starts a thread with its first message. */
export async function createThread(body: MessageThreadCreateBody): Promise<MessageThreadRecord> {
  const { data } = await apiClient.post<MessageThreadRecord>(endpoints.messageThreads.list, body);
  return data;
}

/** One page of a thread's conversation. */
export async function listMessages(
  threadId: string,
  query: MessagesQuery = {},
): Promise<Page<MessageRecord>> {
  return fetchPage<MessageRecord>(apiClient, endpoints.messageThreads.messages(threadId), {
    query: toMessagesQueryParams(query),
  });
}

/** Posts a reply (`communication.message.create`). */
export async function postMessage(
  threadId: string,
  body: MessageCreateBody,
): Promise<MessageRecord> {
  const { data } = await apiClient.post<MessageRecord>(
    endpoints.messageThreads.messages(threadId),
    body,
  );
  return data;
}

/** Stamps every unread message of the thread as read by the caller. A POST keyed
 * `communication.message.create` on the server. */
export async function markRead(threadId: string): Promise<MarkReadResult> {
  const { data } = await apiClient.post<MarkReadResult>(
    endpoints.messageThreads.markRead(threadId),
  );
  return data;
}

/** open -> closed. */
export async function closeThread(threadId: string): Promise<MessageThreadRecord> {
  const { data } = await apiClient.post<MessageThreadRecord>(
    endpoints.messageThreads.close(threadId),
  );
  return data;
}

/** closed -> open. */
export async function reopenThread(threadId: string): Promise<MessageThreadRecord> {
  const { data } = await apiClient.post<MessageThreadRecord>(
    endpoints.messageThreads.reopen(threadId),
  );
  return data;
}

/** Staff the caller can add to an internal or group thread; a capped, unpaginated list. */
export async function searchRecipients(search?: string): Promise<ThreadRecipient[]> {
  const { data } = await apiClient.get<ThreadRecipient[]>(endpoints.messageThreads.recipients, {
    query: search ? { search } : undefined,
  });
  return data;
}

/** A short-lived signed URL for one attachment of the thread. */
export async function downloadAttachment(
  threadId: string,
  fileId: string,
): Promise<AttachmentDownload> {
  const { data } = await apiClient.post<AttachmentDownload>(
    endpoints.messageThreads.attachmentDownload(threadId, fileId),
  );
  return data;
}
