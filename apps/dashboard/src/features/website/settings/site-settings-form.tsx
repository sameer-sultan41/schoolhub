"use client";

import { useId, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import {
  Alert,
  Button,
  Card,
  CardContent,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@schoolhub/ui";

import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { queryKeys } from "@/lib/query-client";
import { Services, type ThemeRecord, type WebsiteSettingsRecord } from "@/services";
import {
  ANALYTICS_ID_MAX,
  WEBSITE_SETTINGS_KEY,
  WEBSITE_SETTINGS_RESOURCE,
} from "@/services/modules/website/website-settings/website-settings-constant";
import { WEBSITE_QUERY_MODULE } from "@/services/shared/website-content";
import { withReasonText } from "@/features/website/shared/reason-message";
import { SchemaFields, useSchemaMessages } from "@/features/website/shared/schema-fields";
import { rekeySchemaErrors, toSchemaFormValues } from "@/features/website/shared/schema-model";
import {
  submitAfterUploads,
  UploadTrackerProvider,
  useUploadTracker,
} from "@/features/website/shared/upload-tracker";
import {
  buildSiteSettingsInput,
  currentTheme,
  siteSettingsFields,
  siteSettingsFormValues,
  siteSettingsResolver,
  themeConfigSchema,
  type SiteSettingsFormValues,
} from "./site-settings-schema";
import { SocialLinksField } from "./social-links-field";

/** Where the theme's config sits, in the form and in the API's 422 keys alike. */
const THEME_CONFIG = "theme_config";

export interface SiteSettingsFormProps {
  settings: WebsiteSettingsRecord;
  themes: readonly ThemeRecord[];
  /** `website.settings.update`: without it every input is read-only and there is no Save. */
  canUpdate: boolean;
}

/**
 * The theme, its settings (a form generated from the theme's `config_schema`), the social links
 * and the analytics id, saved together. Choosing another theme starts its settings afresh. A
 * refusal lands under the input it names (a theme setting through the schema's own paths), or as
 * the form's message. Mounted once the settings and themes are in.
 */
export function SiteSettingsForm({ settings, themes, canUpdate }: SiteSettingsFormProps) {
  const t = useTranslations("website.settings");
  const tCommon = useTranslations("common");
  const tReasons = useTranslations("website.reasons");
  const queryClient = useQueryClient();
  const invalidateWebsite = useInvalidateModule(WEBSITE_QUERY_MODULE);
  const tracker = useUploadTracker();
  const messages = useSchemaMessages();
  const resolver = useMemo(() => siteSettingsResolver(themes, messages), [themes, messages]);
  const form = useForm<SiteSettingsFormValues>({
    resolver,
    defaultValues: siteSettingsFormValues(settings, themes),
  });
  const themeId = useWatch({ control: form.control, name: "theme_id" });
  const configSchema = themeConfigSchema(themes, themeId);
  const chosen = themes.find((theme) => theme.id === themeId);
  const hasConfig = Object.keys(configSchema.properties ?? {}).length > 0;
  const configHeadingId = useId();
  // The theme-setting inputs the last refusal named; read when that refusal is mapped.
  const configFields = useRef<string[]>([]);

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: async (values: SiteSettingsFormValues) => {
      try {
        return await Services.websiteSettings.updateWebsiteSettings(
          buildSiteSettingsInput(values, themes),
        );
      } catch (failure) {
        const rekeyed = rekeySchemaErrors(withReasonText(failure, tReasons), {
          schema: themeConfigSchema(themes, values.theme_id),
          values: values.theme_config,
          serverPrefix: THEME_CONFIG,
          fieldPrefix: THEME_CONFIG,
        });
        configFields.current = rekeyed.fields;
        throw rekeyed.error;
      }
    },
    knownFields: () => [...siteSettingsFields(form.getValues()), ...configFields.current],
    onSuccess: (saved) => {
      queryClient.setQueryData(
        queryKeys.detail(WEBSITE_QUERY_MODULE, WEBSITE_SETTINGS_RESOURCE, WEBSITE_SETTINGS_KEY),
        saved,
      );
      invalidateWebsite();
      form.reset(siteSettingsFormValues(saved, themes));
      toast.success(t(settings.exists ? "saved" : "created"));
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  function chooseTheme(id: string) {
    form.setValue("theme_id", id, { shouldDirty: true });
    // A theme's settings are its own: the saved ones for the saved theme, empty for another.
    const stored = id === currentTheme(settings, themes)?.id ? settings.theme_config : {};
    form.setValue(THEME_CONFIG, toSchemaFormValues(themeConfigSchema(themes, id), stored), {
      shouldDirty: true,
    });
  }

  return (
    <Card>
      <CardContent className="p-6">
        <UploadTrackerProvider value={tracker}>
          <Form {...form}>
            <form
              noValidate
              onSubmit={submitAfterUploads(tracker, handleSubmit)}
              className="max-w-2xl space-y-6"
            >
              {formError && <Alert variant="destructive">{formError}</Alert>}
              <fieldset disabled={!canUpdate} className="space-y-6">
                <FormField
                  control={form.control}
                  name="theme_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("theme")}</FormLabel>
                      <Select value={field.value} onValueChange={chooseTheme} disabled={!canUpdate}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t("themePlaceholder")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {themes.map((theme) => (
                            <SelectItem key={theme.id} value={theme.id}>
                              {t("themeOption", { name: theme.name, version: theme.version })}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {chosen?.description ? (
                        <FormDescription>{chosen.description}</FormDescription>
                      ) : null}
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <section className="space-y-3" aria-labelledby={configHeadingId}>
                  <h3 id={configHeadingId} className="text-sm font-semibold text-foreground">
                    {t("themeConfig")}
                  </h3>
                  {hasConfig ? (
                    <SchemaFields
                      key={themeId}
                      form={form}
                      schema={configSchema}
                      name={THEME_CONFIG}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">{t("noThemeConfig")}</p>
                  )}
                </section>
                <SocialLinksField form={form} />
                <FormField
                  control={form.control}
                  name="analytics_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("analyticsId")}</FormLabel>
                      <FormControl>
                        <Input {...field} dir="ltr" maxLength={ANALYTICS_ID_MAX} />
                      </FormControl>
                      <FormDescription>{t("analyticsHint")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </fieldset>
              {canUpdate ? (
                <Button
                  type="submit"
                  disabled={tracker.isUploading}
                  isLoading={isPending}
                  loadingLabel={tCommon("saving")}
                >
                  {settings.exists ? tCommon("save") : t("createSite")}
                </Button>
              ) : null}
            </form>
          </Form>
        </UploadTrackerProvider>
      </CardContent>
    </Card>
  );
}
