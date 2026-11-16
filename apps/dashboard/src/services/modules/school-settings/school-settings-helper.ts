import type { TenantBranding } from "@schoolhub/types";

import { isSupportedLocale, SUPPORTED_LOCALES } from "@/lib/env";
import { PRIMARY_COLOR_KEY } from "./school-settings-constant";
import type { SchoolProfileFormValues } from "./school-settings.schema";
import type { SchoolSettingsRecord, SchoolSettingsUpdate } from "./school-settings-type";

/** The school-settings module's pure helpers: plain data in, plain data out. */

/** The stored branding as the `TenantBranding` contract; the wire type is free-form JSON. */
export function brandingOf(record: Pick<SchoolSettingsRecord, "branding">): TenantBranding {
  const branding = record.branding;
  return branding !== null && typeof branding === "object" ? branding : {};
}

/** The picker's value for the stored locale: a locale the dashboard has no UI for shows as the
 * default. */
function profileLocaleOf(record: Pick<SchoolSettingsRecord, "locale">) {
  return isSupportedLocale(record.locale) ? record.locale : SUPPORTED_LOCALES[0];
}

export function settingsToProfileValues(record: SchoolSettingsRecord): SchoolProfileFormValues {
  return {
    name: record.name,
    logo_file_id: record.logo_file_id ?? "",
    primary_color: brandingOf(record)[PRIMARY_COLOR_KEY] ?? "",
    timezone: record.timezone,
    locale: profileLocaleOf(record),
    currency: record.currency,
  };
}

/**
 * Form values -> the `PATCH` body. Branding sends only the colour, which the server merges into
 * the stored keys; a blank colour is `null`. The logo and the locale are sent only when they
 * changed: an untouched logo would re-validate the saved file, and an untouched locale the
 * picker can't show (`ar`, `en-GB`) would be overwritten with the default it displays.
 */
export function buildSchoolProfileBody(
  values: SchoolProfileFormValues,
  record: Pick<SchoolSettingsRecord, "logo_file_id" | "locale">,
): SchoolSettingsUpdate {
  const color = values.primary_color.trim();
  const body: SchoolSettingsUpdate = {
    name: values.name.trim(),
    branding: { [PRIMARY_COLOR_KEY]: color === "" ? null : color },
    timezone: values.timezone.trim(),
    currency: values.currency.trim().toUpperCase(),
  };
  if (values.logo_file_id !== (record.logo_file_id ?? "")) {
    body.logo_file_id = values.logo_file_id || null;
  }
  if (values.locale !== profileLocaleOf(record)) {
    body.locale = values.locale;
  }
  return body;
}
