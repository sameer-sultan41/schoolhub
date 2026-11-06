import {
  approveResults,
  fetchResultsPage,
  processResults,
  publishResults,
  sendResultsBack,
  withholdResult,
} from "./exam-results-service";

export const ExamResultsService = {
  fetchResultsPage,
  processResults,
  approveResults,
  sendResultsBack,
  publishResults,
  withholdResult,
};
export type {
  ResultOutcome,
  ResultPageQuery,
  ResultRecord,
  ResultsApproved,
  ResultsPublished,
  ResultsSentBack,
  ResultStatus,
} from "./exam-results-type";
