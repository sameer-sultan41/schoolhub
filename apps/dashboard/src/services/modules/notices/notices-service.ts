import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toNoticesQueryParams } from "./notices-helper";
import type { NoticeRead, NoticesQuery } from "./notices-type";

/** Notices as a guardian reads them (`/notices`); a guardian gets the portal shape. */

export async function listNotices(query: NoticesQuery = {}): Promise<Page<NoticeRead>> {
  return fetchPage<NoticeRead>(apiClient, endpoints.notices.list, {
    query: toNoticesQueryParams(query),
  });
}

export async function fetchNotice(id: string): Promise<NoticeRead> {
  const { data } = await apiClient.get<NoticeRead>(endpoints.notices.detail(id));
  return data;
}

/** Idempotent: acknowledging twice is not an error. Answers no body. */
export async function acknowledgeNotice(id: string): Promise<void> {
  await apiClient.post<unknown>(endpoints.notices.acknowledge(id));
}
