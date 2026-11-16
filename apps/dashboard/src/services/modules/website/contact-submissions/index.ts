import {
  fetchContactSubmission,
  fetchContactSubmissionPage,
  setContactSubmissionStatus,
} from "./contact-submissions-service";

export const ContactSubmissionsService = {
  fetchContactSubmissionPage,
  fetchContactSubmission,
  setContactSubmissionStatus,
};
export type {
  ContactSubmissionQuery,
  ContactSubmissionRecord,
  ContactSubmissionStatus,
} from "./contact-submissions-type";
