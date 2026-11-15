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

export function settingsToProfileValues(record: SchoolSettingsRecord): SchoolProfileFormValues {
  return {
    name: record.name,
    logo_file_id: record.logo_file_id ?? "",
    primary_color: brandingOf(record)[PRIMARY_COLOR_KEY] ?? "",
    timezone: record.timezone,
    locale: isSupportedLocale(record.locale) ? record.locale : SUPPORTED_LOCALES[0],
    currency: record.currency,
  };
}

/**
 * Form values -> the `PATCH` body. Branding sends only the colour, which the server merges into
 * the stored keys; a blank colour is `null`. The logo is sent only when it changed, so an
 * untouched form never re-validates the saved file.
 */
export function buildSchoolProfileBody(
  values: SchoolProfileFormValues,
  record: Pick<SchoolSettingsRecord, "logo_file_id">,
): SchoolSettingsUpdate {
  const color = values.primary_color.trim();
  const body: SchoolSettingsUpdate = {
    name: values.name.trim(),
    branding: { [PRIMARY_COLOR_KEY]: color === "" ? null : color },
    timezone: values.timezone.trim(),
    locale: values.locale,
    currency: values.currency.trim().toUpperCase(),
  };
  if (values.logo_file_id !== (record.logo_file_id ?? "")) {
    body.logo_file_id = values.logo_file_id || null;
  }
  return body;
}
