import {
  fetchReportCardDownloadUrl,
  fetchReportCardsPage,
  generateReportCards,
  publishReportCards,
  updateRemarks,
} from "./report-cards-service";

export const ReportCardsService = {
  fetchReportCardsPage,
  generateReportCards,
  publishReportCards,
  updateRemarks,
  fetchReportCardDownloadUrl,
};
export type {
  ReportCardPageQuery,
  ReportCardRecord,
  ReportCardRemarkField,
  ReportCardRemarksInput,
  ReportCardsPublished,
  ReportCardStatus,
} from "./report-cards-type";
