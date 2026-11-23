import { fail, ok } from "../envelope";
import type { MockModule } from "../router";

/**
 * `GET/PATCH /onboarding` (`apps/platform_admin/onboarding/`). The server computes each step from
 * the school's rows; this stub takes which steps are done as given and keeps the two things the
 * server stores: the profile confirmation and the skips. Its refusals copy the server's (L5):
 * `OnboardingUpdateSerializer.validate` and `services.update_onboarding`.
 */

export type OnboardingStepKey =
  | "profile"
  | "campuses"
  | "academic_session"
  | "classes"
  | "subjects"
  | "fee_structures"
  | "staff_invites"
  | "students"
  | "go_live";

/** The generated `OnboardingStep` wire shape. */
export interface OnboardingStep {
  key: OnboardingStepKey;
  done: boolean;
  skipped: boolean;
  skippable: boolean;
  count?: number;
}

/** The server's step order (`services.STEPS`). */
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

const SKIPPABLE = new Set<OnboardingStepKey>(["fee_structures", "staff_invites", "students"]);
const UNCOUNTED = new Set<OnboardingStepKey>(["profile", "go_live"]);
const ACTIONS = ["confirm", "skip", "unskip"] as const;

export interface OnboardingOptions {
  /** Steps whose rows exist. `profile` is done by confirming it (or listing it here). */
  done?: readonly OnboardingStepKey[];
  skipped?: readonly OnboardingStepKey[];
  /** The steps the school has (a module that is off drops its step). */
  keys?: readonly OnboardingStepKey[];
  completedAt?: string | null;
}

/** Every step done, as a school that has gone live: the home page's default, so the "Finish
 * setting up" card stays out of specs that are not about it. */
export const FINISHED_ONBOARDING: OnboardingOptions = {
  done: ONBOARDING_STEP_KEYS,
  completedAt: "2026-11-01T09:00:00Z",
};

export function onboardingModule(options: OnboardingOptions = {}): MockModule {
  return (api) => {
    const keys = options.keys ?? ONBOARDING_STEP_KEYS;
    const done = new Set(options.done ?? []);
    const skipped = new Set(options.skipped ?? []);
    let completedAt = options.completedAt ?? null;

    function checklist() {
      const steps: OnboardingStep[] = keys.map((key) => ({
        key,
        done: done.has(key),
        skipped: skipped.has(key),
        skippable: SKIPPABLE.has(key),
        ...(UNCOUNTED.has(key) ? {} : { count: done.has(key) ? 1 : 0 }),
      }));
      const completed = steps.every((step) => step.done || step.skipped);
      if (completed && completedAt === null) completedAt = new Date().toISOString();
      return { steps, completed, completed_at: completedAt };
    }

    api.get("/onboarding", () => ok(checklist()));

    api.patch("/onboarding", (request) => {
      const body = (request.json() ?? {}) as Partial<Record<(typeof ACTIONS)[number], string>>;
      const sent = ACTIONS.filter((action) => body[action] !== undefined);
      if (sent.length !== 1) {
        return fail(400, "Send exactly one of confirm, skip or unskip.", {
          details: [
            { field: "non_field_errors", issue: "Send exactly one of confirm, skip or unskip." },
          ],
        });
      }
      if (body.confirm !== undefined) {
        if (body.confirm !== "profile") {
          return fail(422, "Only the profile step is confirmed by hand.", {
            details: [{ field: "confirm", issue: "Only the profile step is confirmed by hand." }],
          });
        }
        done.add("profile");
      }
      for (const action of ["skip", "unskip"] as const) {
        const key = body[action] as OnboardingStepKey | undefined;
        if (key === undefined) continue;
        if (!SKIPPABLE.has(key)) {
          const issue = `The '${key}' step cannot be skipped.`;
          return fail(422, issue, { details: [{ field: action, issue }] });
        }
        if (action === "skip") skipped.add(key);
        else skipped.delete(key);
      }
      return ok(checklist(), { meta: { message: "Setup progress updated." } });
    });
  };
}
