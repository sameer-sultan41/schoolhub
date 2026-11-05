import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toReportCardsQueryParams } from "./report-cards-helper";
import type { ReportCardsQuery, ReportCardRecord } from "./report-cards-type";

export async function listReportCards(
  query: ReportCardsQuery = {},
): Promise<Page<ReportCardRecord>> {
  return fetchPage<ReportCardRecord>(apiClient, endpoints.reportCards.list, {
    query: toReportCardsQueryParams(query),
  });
}

export async function fetchReportCard(id: string): Promise<ReportCardRecord> {
  const { data } = await apiClient.get<ReportCardRecord>(endpoints.reportCards.detail(id));
  return data;
}
