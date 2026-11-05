import { listReportCards, fetchReportCard } from "./report-cards-service";

export const ReportCardsService = {
  listReportCards,
  fetchReportCard,
};
export type { ReportCardRecord, ReportCardsQuery } from "./report-cards-type";
