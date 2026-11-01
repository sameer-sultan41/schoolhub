import { servicesMock } from "@/test-fixtures/services-mock";

/** The `@/services` mock the broadcast tests share (see `servicesMock`). */
export function broadcastServicesMock() {
  return servicesMock({
    broadcasts: ["preview", "send"],
    dashboard: ["fetchCampuses"],
    schoolOrganization: ["fetchClasses", "fetchSections"],
    jobs: ["fetchJob"],
  });
}
