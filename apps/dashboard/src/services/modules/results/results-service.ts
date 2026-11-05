import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toResultsQueryParams } from "./results-helper";
import type { ResultsQuery, ResultRecord } from "./results-type";

export async function listResults(query: ResultsQuery = {}): Promise<Page<ResultRecord>> {
  return fetchPage<ResultRecord>(apiClient, endpoints.results.list, {
    query: toResultsQueryParams(query),
  });
}
