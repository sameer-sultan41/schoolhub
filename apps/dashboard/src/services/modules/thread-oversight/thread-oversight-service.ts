import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toMessagesQueryParams } from "@/services/modules/message-threads/message-threads-helper";
import type {
  AttachmentDownload,
  MessageRecord,
} from "@/services/modules/message-threads/message-threads-type";
import { toOversightQueryParams } from "./thread-oversight-helper";
import type {
  MessagesQuery,
  ThreadOversightQuery,
  ThreadOversightRecord,
} from "./thread-oversight-type";

/**
 * The thread-oversight domain's API calls (`/message-thread-oversight`): every alive thread in
 * the tenant, read-only. Each read of a thread or its messages writes an audit row on the
 * server. Reached through `Services.threadOversight.*`.
 */

/** One page of the tenant's threads. */
export async function listThreads(
  query: ThreadOversightQuery,
): Promise<Page<ThreadOversightRecord>> {
  return fetchPage<ThreadOversightRecord>(apiClient, endpoints.threadOversight.list, {
    query: toOversightQueryParams(query),
  });
}

/** One thread; audited. */
export async function fetchThread(threadId: string): Promise<ThreadOversightRecord> {
  const { data } = await apiClient.get<ThreadOversightRecord>(
    endpoints.threadOversight.detail(threadId),
  );
  return data;
}

/** One page of the whole conversation, internal notes included; audited, never marks read. */
export async function listMessages(
  threadId: string,
  query: MessagesQuery = {},
): Promise<Page<MessageRecord>> {
  return fetchPage<MessageRecord>(apiClient, endpoints.threadOversight.messages(threadId), {
    query: toMessagesQueryParams(query),
  });
}

/** A signed URL for one attachment, internal notes' included; audited once the link is signed. */
export async function downloadAttachment(
  threadId: string,
  fileId: string,
): Promise<AttachmentDownload> {
  const { data } = await apiClient.post<AttachmentDownload>(
    endpoints.threadOversight.attachmentDownload(threadId, fileId),
  );
  return data;
}
