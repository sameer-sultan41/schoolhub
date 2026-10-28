import { servicesMock } from "@/test-fixtures/services-mock";

/** The `@/services` mock the Corrections tests share (see `servicesMock`). */
export function correctionsServicesMock() {
  return servicesMock({
    auth: ["fetchCurrentUser"],
    attendanceCorrections: ["fetchCorrectionPage", "decideCorrection", "requestCorrection"],
  });
}
