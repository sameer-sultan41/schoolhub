import {
  closeThread,
  createThread,
  downloadAttachment,
  fetchThread,
  listMessages,
  listThreads,
  markRead,
  postMessage,
  reopenThread,
  searchRecipients,
} from "./message-threads-service";

export const MessageThreadsService = {
  listThreads,
  fetchThread,
  createThread,
  listMessages,
  postMessage,
  markRead,
  closeThread,
  reopenThread,
  searchRecipients,
  downloadAttachment,
};

export type {
  AttachmentDownload,
  MarkReadResult,
  MessageCreateBody,
  MessageRecord,
  MessagesQuery,
  MessageThreadCreateBody,
  MessageThreadRecord,
  MessageThreadsQuery,
  MessageThreadStatus,
  ThreadRecipient,
  ThreadType,
} from "./message-threads-type";
