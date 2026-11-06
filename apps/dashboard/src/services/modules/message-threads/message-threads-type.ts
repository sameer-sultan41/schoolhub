import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shapes (ADR-0017). */
export type MessageThreadRecord = ApiSchemas["MessageThread"];
export type MessageRecord = ApiSchemas["Message"];
export type MessageThreadCreateBody = ApiSchemas["MessageThreadCreate"];
export type MessageCreateBody = ApiSchemas["MessageCreate"];
export type ThreadRecipient = ApiSchemas["ThreadRecipient"];
export type ThreadType = ApiSchemas["ThreadTypeEnum"];
export type MessageThreadStatus = ApiSchemas["MessageThreadStatusEnum"];
export type MarkReadResult = ApiSchemas["MarkReadResult"];
export type AttachmentDownload = ApiSchemas["AttachmentDownload"];

/** The inbox filters; `cursor` is the page to read (omitted for the first). */
export interface MessageThreadsQuery {
  status?: MessageThreadStatus;
  threadType?: ThreadType;
  studentId?: string;
  cursor?: string;
  pageSize?: number;
}

/** One page of a thread's messages. */
export interface MessagesQuery {
  cursor?: string;
  pageSize?: number;
}
