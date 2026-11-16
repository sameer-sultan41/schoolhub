import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import type { OnboardingRecord, OnboardingUpdate } from "./onboarding-type";

/** The school's setup checklist (`/onboarding`), reached through `Services.onboarding.*`. */

export async function fetchOnboarding(): Promise<OnboardingRecord> {
  const { data } = await apiClient.get<OnboardingRecord>(endpoints.onboarding.detail);
  return data;
}

/** Confirms the profile, or skips a skippable step or takes the skip back; answers the updated
 * checklist. */
export async function updateOnboarding(body: OnboardingUpdate): Promise<OnboardingRecord> {
  const { data } = await apiClient.patch<OnboardingRecord>(endpoints.onboarding.detail, body);
  return data;
}
