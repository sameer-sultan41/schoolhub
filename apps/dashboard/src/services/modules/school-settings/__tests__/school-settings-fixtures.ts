import type { SchoolSettingsRecord } from "@/services";

export const LOGO_FILE_ID = "9e0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b";

/** City School, with a primary colour and no logo; override what a test needs. */
export function schoolSettingsRecord(
  overrides: Partial<SchoolSettingsRecord> = {},
): SchoolSettingsRecord {
  return {
    name: "City School",
    logo_file_id: null,
    logo_url: null,
    branding: { primary_color: "#1E88E5", radius: "0.5rem" },
    academic: {},
    timezone: "Asia/Karachi",
    locale: "en",
    currency: "PKR",
    ...overrides,
  };
}
