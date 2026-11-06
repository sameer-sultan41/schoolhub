import type { LeaveDayPart } from "@/services";

/** Each day part's message key under `portal.leave` (exhaustive, so a new one fails the build). */
export const LEAVE_DAY_PART_LABEL_KEY: Record<LeaveDayPart, string> = {
  full: "dayPart.full",
  first_half: "dayPart.first_half",
  second_half: "dayPart.second_half",
};
