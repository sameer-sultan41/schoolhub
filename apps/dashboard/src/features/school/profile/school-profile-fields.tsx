"use client";

import { useTranslations } from "next-intl";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { Button } from "@schoolhub/ui";

import { FormSelectField } from "@/components/form-select-field";
import { PhotoUploadField } from "@/components/photo-upload-field";
import { TextFormField } from "@/features/school/shared/text-form-field";
import { SUPPORTED_LOCALES } from "@/lib/env";
import { Regex } from "@/lib/regex";
import type { SchoolSettingsRecord } from "@/services";
import {
  SCHOOL_CURRENCY_LENGTH,
  SCHOOL_LOGO_ACCEPT,
  SCHOOL_LOGO_PURPOSE,
  SCHOOL_NAME_MAX,
  SCHOOL_TIMEZONE_MAX,
} from "@/services/modules/school-settings/school-settings-constant";
import type { SchoolProfileFormValues } from "@/services/modules/school-settings/school-settings.schema";

/** A page form is mounted once, so an upload's result always belongs to it. */
const SAME_SESSION = () => () => true;

export interface SchoolProfileFieldsProps {
  form: UseFormReturn<SchoolProfileFormValues>;
  settings: SchoolSettingsRecord;
  /** A `useState` setter, so it is stable (the upload field's effect depends on it). */
  onUploadingChange: (uploading: boolean) => void;
}

/** The profile form's inputs. Every field renders its own `FormMessage`, so a server error the
 * form maps onto it shows under it. */
export function SchoolProfileFields({
  form,
  settings,
  onUploadingChange,
}: SchoolProfileFieldsProps) {
  const t = useTranslations("school");
  const [name, logoFileId, primaryColor] = useWatch({
    control: form.control,
    name: ["name", "logo_file_id", "primary_color"],
  });
  const localeOptions = SUPPORTED_LOCALES.map((locale) => ({
    id: locale,
    name: t(`profile.locales.${locale}`),
  }));
  const swatch = Regex.HEX_COLOR.test(primaryColor.trim()) ? primaryColor.trim() : undefined;

  return (
    <>
      <TextFormField
        form={form}
        name="name"
        label={t("profile.fields.name")}
        maxLength={SCHOOL_NAME_MAX}
      />
      <div className="space-y-2">
        <PhotoUploadField
          form={form}
          uploadPurpose={SCHOOL_LOGO_PURPOSE}
          fileIdField="logo_file_id"
          fallbackName={name}
          label={t("profile.fields.logo")}
          accept={SCHOOL_LOGO_ACCEPT}
          savedPhotoFileId={settings.logo_file_id}
          savedPhotoUrl={settings.logo_url}
          onUploadStart={SAME_SESSION}
          onUploadingChange={onUploadingChange}
        />
        {logoFileId ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              form.setValue("logo_file_id", "", { shouldDirty: true });
            }}
          >
            {t("profile.removeLogo")}
          </Button>
        ) : null}
      </div>
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <TextFormField
            form={form}
            name="primary_color"
            label={t("profile.fields.primaryColor")}
            placeholder={t("form.colorPlaceholder")}
            description={t("profile.primaryColorHint")}
          />
        </div>
        {swatch ? (
          // The colour is the school's own data, so an inline style, not a theme token.
          <span
            aria-hidden="true"
            className="mb-7 size-9 shrink-0 rounded-md border border-border"
            style={{ backgroundColor: swatch }}
          />
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TextFormField
          form={form}
          name="timezone"
          label={t("fields.timezone")}
          maxLength={SCHOOL_TIMEZONE_MAX}
          placeholder={t("form.timezonePlaceholder")}
        />
        <FormSelectField
          form={form}
          name="locale"
          label={t("profile.fields.locale")}
          placeholder={t("profile.fields.locale")}
          options={localeOptions}
        />
        <TextFormField
          form={form}
          name="currency"
          label={t("profile.fields.currency")}
          maxLength={SCHOOL_CURRENCY_LENGTH}
          description={t("profile.currencyHint")}
        />
      </div>
    </>
  );
}
