import type { OnboardingRecord, OnboardingStep, OnboardingStepKey } from "@/services";

/** The server's step order (`apps/platform_admin/onboarding/services.py`'s `STEPS`). */
export const ONBOARDING_STEP_KEYS: readonly OnboardingStepKey[] = [
  "profile",
  "campuses",
  "academic_session",
  "classes",
  "subjects",
  "fee_structures",
  "staff_invites",
  "students",
  "go_live",
];

const SKIPPABLE: ReadonlySet<OnboardingStepKey> = new Set([
  "fee_structures",
  "staff_invites",
  "students",
]);
/** The steps the server answers without a count. */
const UNCOUNTED: ReadonlySet<OnboardingStepKey> = new Set(["profile", "go_live"]);

/** One step as the server sends it: a counted step carries `count`, profile and go-live don't. */
export function onboardingStep(
  key: OnboardingStepKey,
  overrides: Partial<Omit<OnboardingStep, "key">> = {},
): OnboardingStep {
  const done = overrides.done ?? false;
  return {
    key,
    done,
    skipped: false,
    skippable: SKIPPABLE.has(key),
    ...(UNCOUNTED.has(key) ? {} : { count: done ? 1 : 0 }),
    ...overrides,
  };
}

/** A checklist over every step (or `keys`), with the given steps done or skipped. */
export function onboardingRecord({
  done = [],
  skipped = [],
  keys = ONBOARDING_STEP_KEYS,
  completedAt = null,
}: {
  done?: readonly OnboardingStepKey[];
  skipped?: readonly OnboardingStepKey[];
  keys?: readonly OnboardingStepKey[];
  completedAt?: string | null;
} = {}): OnboardingRecord {
  const steps = keys.map((key) =>
    onboardingStep(key, { done: done.includes(key), skipped: skipped.includes(key) }),
  );
  return {
    steps,
    completed: steps.every((step) => step.done || step.skipped),
    completed_at: completedAt,
  };
}
