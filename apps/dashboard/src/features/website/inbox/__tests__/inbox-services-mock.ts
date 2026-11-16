import { servicesMock } from "@/test-fixtures/services-mock";

/** The `@/services` mock the contact inbox tests use, reached through `jest.requireActual`. */
export function inboxServicesMock() {
  return servicesMock({
    auth: ["fetchCurrentUser"],
    contactSubmissions: [
      "fetchContactSubmissionPage",
      "fetchContactSubmission",
      "setContactSubmissionStatus",
    ],
  });
}
