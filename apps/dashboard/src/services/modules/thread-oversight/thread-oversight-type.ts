import type { ApiSchemas } from "@schoolhub/api-client";

import type { MessagesQuery } from "@/services/modules/message-threads/message-threads-type";

/** The generated wire shape (ADR-0017); messages and the download link share the inbox's. */
export type ThreadOversightRecord = ApiSchemas["ThreadOversight"];

export type { MessagesQuery };

/** The oversight list's filters; `cursor` is the page to read (omitted for the first). */
export interface ThreadOversightQuery {
  status?: ApiSchemas["MessageThreadStatusEnum"];
  threadType?: ApiSchemas["ThreadTypeEnum"];
  studentId?: string;
  assignedTo?: string;
  cursor?: string;
  pageSize?: number;
}
