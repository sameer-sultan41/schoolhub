/** The settings domain's constants. Reads live under `WEBSITE_QUERY_MODULE` (`website-content.ts`). */
export const WEBSITE_SETTINGS_RESOURCE = "settings";
/** The detail key `GET /website-settings` is read under: the tenant has one settings row. */
export const WEBSITE_SETTINGS_KEY = "current";

/** Column limits mirroring `website_cms/settings/serializers.py` and `models.py`. */
export const SOCIAL_PLATFORM_MAX = 50;
export const SOCIAL_URL_MAX = 500;
export const ANALYTICS_ID_MAX = 60;
