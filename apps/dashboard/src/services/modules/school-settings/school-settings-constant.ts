/** The school-settings module's constants. */

/** The upload purpose the logo is sent under (`apps/school_organization/uploads.py`). */
export const SCHOOL_LOGO_PURPOSE = "school.logo";
/** What that purpose accepts; the server's registry is the authority. */
export const SCHOOL_LOGO_ACCEPT = "image/png,image/jpeg,image/webp";

/** The column limits (`Tenant.name`, `Tenant.timezone`). */
export const SCHOOL_NAME_MAX = 200;
export const SCHOOL_TIMEZONE_MAX = 64;
export const SCHOOL_CURRENCY_LENGTH = 3;

/** The branding key the profile form edits (the `TenantBranding` contract). */
export const PRIMARY_COLOR_KEY = "primary_color";

/** The fields a server error may name on the profile form; any other shows as its message. */
export const SCHOOL_PROFILE_ERROR_FIELDS = [
  "name",
  "logo_file_id",
  "primary_color",
  "timezone",
  "locale",
  "currency",
] as const;

/** The server nests the colour's error under `branding`; the form's input is the colour. */
export const SCHOOL_PROFILE_FIELD_ALIASES: Readonly<Record<string, string>> = {
  [`branding.${PRIMARY_COLOR_KEY}`]: PRIMARY_COLOR_KEY,
};
