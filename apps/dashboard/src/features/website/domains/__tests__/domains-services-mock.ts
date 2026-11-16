import { servicesMock } from "@/test-fixtures/services-mock";

/** The `@/services` mock the custom-domains tests use, reached through `jest.requireActual`. */
export function domainsServicesMock() {
  return servicesMock({
    auth: ["fetchCurrentUser"],
    customDomains: [
      "fetchCustomDomains",
      "createCustomDomain",
      "verifyCustomDomain",
      "setPrimaryCustomDomain",
      "deleteCustomDomain",
    ],
  });
}
