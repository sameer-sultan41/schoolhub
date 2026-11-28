import { set, type FieldErrors, type Resolver } from "react-hook-form";
import { z } from "zod";

import type {
  JsonSchema,
  ThemeRecord,
  WebsiteSettingsInput,
  WebsiteSettingsRecord,
} from "@/services";
import { asJsonSchema } from "@/services/modules/website/themes/themes-helper";
import {
  ANALYTICS_ID_MAX,
  SOCIAL_PLATFORM_MAX,
  SOCIAL_URL_MAX,
} from "@/services/modules/website/website-settings/website-settings-constant";
import {
  fromSchemaFormValues,
  isSafeUrl,
  toSchemaFormValues,
  type SchemaFormValues,
} from "@/features/website/shared/schema-model";
import { schemaToZod, type SchemaMessages } from "@/features/website/shared/schema-zod";

/**
 * The settings form's pure half. The site's status (published, maintenance) is not in this
 * form: each switch saves on its own, after a confirm. Everything else here is one PATCH.
 */

export interface SocialLinkValues {
  platform: string;
  url: string;
}

export interface SiteSettingsFormValues {
  theme_id: string;
  /** The chosen theme's `config_schema` values (decision 12: rendered by `SchemaFields`). */
  theme_config: SchemaFormValues;
  social_links: SocialLinkValues[];
  analytics_id: string;
}

/** The theme the settings name: by id, else by code (the unsaved default carries both). */
export function currentTheme(
  settings: WebsiteSettingsRecord,
  themes: readonly ThemeRecord[],
): ThemeRecord | undefined {
  return (
    themes.find((theme) => theme.id === settings.theme_id) ??
    themes.find((theme) => theme.code === settings.theme_code)
  );
}

/** A theme's config schema; an unknown theme id has none. */
export function themeConfigSchema(themes: readonly ThemeRecord[], themeId: string): JsonSchema {
  return asJsonSchema(themes.find((theme) => theme.id === themeId)?.config_schema);
}

export function siteSettingsFormValues(
  settings: WebsiteSettingsRecord,
  themes: readonly ThemeRecord[],
): SiteSettingsFormValues {
  const themeId = currentTheme(settings, themes)?.id ?? "";
  return {
    theme_id: themeId,
    theme_config: toSchemaFormValues(themeConfigSchema(themes, themeId), settings.theme_config),
    social_links: (settings.social_links ?? []).map(({ platform, url }) => ({ platform, url })),
    analytics_id: settings.analytics_id ?? "",
  };
}

function siteSettingsSchema(configSchema: JsonSchema, messages: SchemaMessages) {
  const bounded = (max: number) =>
    z.string().trim().min(1, messages.required).max(max, messages.tooLong(max));
  return z.object({
    theme_id: z.string().min(1, messages.required),
    theme_config: schemaToZod(configSchema, messages),
    social_links: z.array(
      z.object({
        platform: bounded(SOCIAL_PLATFORM_MAX),
        url: bounded(SOCIAL_URL_MAX).refine(isSafeUrl, messages.unsafeUrl),
      }),
    ),
    analytics_id: z.string().trim().max(ANALYTICS_ID_MAX, messages.tooLong(ANALYTICS_ID_MAX)),
  });
}

/**
 * Checks the values against the theme they name, so a theme switch checks its own config
 * schema. The values pass through unchanged: the payload builder trims.
 */
export function siteSettingsResolver(
  themes: readonly ThemeRecord[],
  messages: SchemaMessages,
): Resolver<SiteSettingsFormValues> {
  return (values) => {
    const schema = siteSettingsSchema(themeConfigSchema(themes, values.theme_id), messages);
    const result = schema.safeParse(values);
    if (result.success) return { values, errors: {} };
    const errors: FieldErrors<SiteSettingsFormValues> = {};
    for (const issue of result.error.issues) {
      set(errors, issue.path.map(String).join("."), { type: issue.code, message: issue.message });
    }
    return { values: {}, errors };
  };
}

/** The PATCH body: the theme, its config as the API takes it, the links and the analytics id. */
export function buildSiteSettingsInput(
  values: SiteSettingsFormValues,
  themes: readonly ThemeRecord[],
): WebsiteSettingsInput {
  return {
    theme_id: values.theme_id,
    theme_config: fromSchemaFormValues(
      themeConfigSchema(themes, values.theme_id),
      values.theme_config,
    ),
    social_links: values.social_links.map((link) => ({
      platform: link.platform.trim(),
      url: link.url.trim(),
    })),
    analytics_id: values.analytics_id.trim(),
  };
}

/** The inputs a server error can name, for the values on screen (one pair per social link). */
export function siteSettingsFields(values: SiteSettingsFormValues): string[] {
  return [
    "theme_id",
    "analytics_id",
    ...values.social_links.flatMap((_link, index) => [
      `social_links.${index}.platform`,
      `social_links.${index}.url`,
    ]),
  ];
}
