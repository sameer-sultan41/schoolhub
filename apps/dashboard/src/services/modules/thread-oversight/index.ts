import {
  downloadAttachment,
  fetchThread,
  listMessages,
  listThreads,
} from "./thread-oversight-service";

export const ThreadOversightService = {
  listThreads,
  fetchThread,
  listMessages,
  downloadAttachment,
};

export type {
  MessagesQuery,
  ThreadOversightQuery,
  ThreadOversightRecord,
} from "./thread-oversight-type";
