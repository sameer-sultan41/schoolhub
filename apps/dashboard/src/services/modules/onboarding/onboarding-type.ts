import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shapes (ADR-0017): what `GET`/`PATCH /onboarding` return, one step of it,
 * a step's key, and the `PATCH` body (exactly one of `confirm`, `skip`, `unskip`). */
export type OnboardingRecord = ApiSchemas["Onboarding"];
export type OnboardingStep = ApiSchemas["OnboardingStep"];
export type OnboardingStepKey = ApiSchemas["OnboardingStepKeyEnum"];
export type OnboardingUpdate = ApiSchemas["PatchedOnboardingUpdate"];
