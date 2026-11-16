import type { OnboardingRecord, OnboardingStep } from "./onboarding-type";

/** The onboarding module's pure helpers: plain data in, plain data out. */

/** A step nobody has to do anything more about: done, or skipped. */
export function isStepSettled(step: OnboardingStep): boolean {
  return step.done || step.skipped;
}

/** The steps still to do, in wizard order. */
export function remainingSteps(record: OnboardingRecord): OnboardingStep[] {
  return record.steps.filter((step) => !isStepSettled(step));
}

/** How far along the school is: settled steps out of all its steps, and the percentage. */
export function setupProgress(record: OnboardingRecord): {
  settled: number;
  total: number;
  percent: number;
} {
  const total = record.steps.length;
  const settled = total - remainingSteps(record).length;
  return { settled, total, percent: total === 0 ? 100 : Math.round((settled / total) * 100) };
}

/** Setup is over once the checklist was ever complete: `completed_at` is stamped once and kept,
 * so a campus deleted after going live does not bring the wizard back. */
export function isSetupFinished(record: OnboardingRecord): boolean {
  return record.completed || record.completed_at !== null;
}
