import {
  fetchAdmitCardDownloadUrl,
  fetchAdmitCardsPage,
  issueAdmitCards,
  revokeAdmitCard,
} from "./admit-cards-service";

export const AdmitCardsService = {
  fetchAdmitCardsPage,
  issueAdmitCards,
  revokeAdmitCard,
  fetchAdmitCardDownloadUrl,
};
export type {
  AdmitCardDownload,
  AdmitCardIssue,
  AdmitCardPageQuery,
  AdmitCardRecord,
  AdmitCardStatus,
} from "./admit-cards-type";
