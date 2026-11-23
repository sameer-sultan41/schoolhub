import { onboardingRecord } from "@/test-fixtures/onboarding";
import { isSetupFinished, remainingSteps, setupProgress } from "../onboarding-helper";

describe("onboarding helpers", () => {
  it("counts a skipped step as settled, not remaining", () => {
    const record = onboardingRecord({ done: ["profile", "campuses"], skipped: ["students"] });

    expect(remainingSteps(record).map((step) => step.key)).toEqual([
      "academic_session",
      "classes",
      "subjects",
      "fee_structures",
      "staff_invites",
      "go_live",
    ]);
    expect(setupProgress(record)).toEqual({ settled: 3, total: 9, percent: 33 });
  });

  it("calls an empty checklist complete", () => {
    expect(setupProgress(onboardingRecord({ keys: [] })).percent).toBe(100);
  });

  it("treats a stamped completion as finished even after a step comes undone", () => {
    const regressed = onboardingRecord({ done: ["profile"], completedAt: "2026-11-16T10:00:00Z" });

    expect(regressed.completed).toBe(false);
    expect(isSetupFinished(regressed)).toBe(true);
    expect(isSetupFinished(onboardingRecord())).toBe(false);
  });
});
