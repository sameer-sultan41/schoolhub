import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";

import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toContentQueryParams } from "@/services/shared/website-content";
import type {
  NewsPostDetail,
  NewsPostInput,
  NewsPostQuery,
  NewsPostRecord,
  NewsPostUpdateInput,
} from "./news-posts-type";

/** The news posts API calls (`/news-posts`), reached through `Services.newsPosts.*`. */

const paths = endpoints.website.newsPosts;

export async function fetchNewsPostPage(query: NewsPostQuery = {}): Promise<Page<NewsPostRecord>> {
  return fetchPage<NewsPostRecord>(apiClient, paths.list, { query: toContentQueryParams(query) });
}

export async function fetchNewsPost(id: string): Promise<NewsPostDetail> {
  const { data } = await apiClient.get<NewsPostDetail>(paths.detail(id));
  return data;
}

export async function createNewsPost(input: NewsPostInput): Promise<NewsPostDetail> {
  const { data } = await apiClient.post<NewsPostDetail>(paths.list, input);
  return data;
}

export async function updateNewsPost(
  id: string,
  input: NewsPostUpdateInput,
): Promise<NewsPostDetail> {
  const { data } = await apiClient.patch<NewsPostDetail>(paths.detail(id), input);
  return data;
}

export async function deleteNewsPost(id: string): Promise<void> {
  await apiClient.delete(paths.detail(id));
}

export async function publishNewsPost(id: string): Promise<NewsPostDetail> {
  const { data } = await apiClient.post<NewsPostDetail>(paths.publish(id));
  return data;
}

export async function unpublishNewsPost(id: string): Promise<NewsPostDetail> {
  const { data } = await apiClient.post<NewsPostDetail>(paths.unpublish(id));
  return data;
}

export async function archiveNewsPost(id: string): Promise<NewsPostDetail> {
  const { data } = await apiClient.post<NewsPostDetail>(paths.archive(id));
  return data;
}
