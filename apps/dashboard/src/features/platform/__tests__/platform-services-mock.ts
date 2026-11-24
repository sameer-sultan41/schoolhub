import { servicesMock } from "@/test-fixtures/services-mock";

/** The `@/services` mock the platform console's tests share: each test file's `jest.mock`
 * factory reaches it through `jest.requireActual`. Every `Services.platform` call, plus the
 * current user. */
export function platformServicesMock() {
  return servicesMock({
    auth: ["fetchCurrentUser"],
    platform: [
      "fetchTenantPage",
      "fetchTenant",
      "createTenant",
      "updateTenant",
      "provisionTenant",
      "suspendTenant",
      "reinstateTenant",
      "deleteTenant",
      "restoreTenant",
      "exportTenant",
      "fetchTenantJob",
      "fetchTenantUsage",
      "refreshTenantUsage",
      "fetchSubscription",
      "updateSubscription",
      "activateSubscription",
      "recordPayment",
      "markPaymentFailed",
      "changePlan",
      "fetchOverrides",
      "createOverride",
      "deleteOverride",
      "fetchPlanPage",
      "fetchActivePlans",
      "createPlan",
      "updatePlan",
      "retirePlan",
      "fetchFlagPage",
      "fetchAllFlags",
      "updateFlag",
      "fetchReport",
      "downloadReport",
    ],
  });
}
