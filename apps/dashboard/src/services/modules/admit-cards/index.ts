import {
  fetchAdmitCardDownloadUrl,
  fetchAdmitCardsPage,
  fetchCurrentAdmitCardsPage,
  issueAdmitCards,
  revokeAdmitCard,
} from "./admit-cards-service";

export const AdmitCardsService = {
  fetchAdmitCardsPage,
  fetchCurrentAdmitCardsPage,
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
  CurrentAdmitCardQuery,
} from "./admit-cards-type";
