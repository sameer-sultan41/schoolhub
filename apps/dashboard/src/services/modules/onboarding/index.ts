import { fetchOnboarding, updateOnboarding } from "./onboarding-service";

export const OnboardingService = {
  fetchOnboarding,
  updateOnboarding,
};
export type {
  OnboardingRecord,
  OnboardingStep,
  OnboardingStepKey,
  OnboardingUpdate,
} from "./onboarding-type";
