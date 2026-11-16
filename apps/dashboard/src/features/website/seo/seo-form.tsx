"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useForm, type UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import {
  Alert,
  Button,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Skeleton,
  Textarea,
} from "@schoolhub/ui";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { LoadErrorCard } from "@/components/load-error-card";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { resolveErrorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { Services, type SeoSettingRecord, type SeoTarget } from "@/services";
import { SEO_SETTINGS_RESOURCE } from "@/services/modules/website/seo-settings/seo-settings-constant";
import { seoTargetKey } from "@/services/modules/website/seo-settings/seo-settings-helper";
import { WEBSITE_QUERY_MODULE } from "@/services/shared/website-content";
import { ContentFormPending } from "@/features/website/shared/content-form-pending";
import { ImageFileField } from "@/features/website/shared/image-file-field";
import { withReasonText } from "@/features/website/shared/reason-message";
import { useSchemaMessages } from "@/features/website/shared/schema-fields";
import {
  submitAfterUploads,
  UploadTrackerProvider,
  useUploadTracker,
  type UploadTracker,
} from "@/features/website/shared/upload-tracker";
import {
  buildSeoInput,
  SEO_FORM_FIELDS,
  SEO_REASON_SCOPE,
  seoFormSchema,
  seoFormValues,
  type SeoFormValues,
} from "./seo-form-schema";

function seoQueryKey(target: SeoTarget) {
  return queryKeys.detail(WEBSITE_QUERY_MODULE, SEO_SETTINGS_RESOURCE, seoTargetKey(target));
}

/** One target's SEO row; a target never saved answers its empty default (`exists: false`). */
export function useSeoSetting(target: SeoTarget) {
  return useQuery({
    queryKey: seoQueryKey(target),
    queryFn: () => Services.seoSettings.fetchSeoSetting(target),
  });
}

/**
 * The form over one target's saved row and its save: `PATCH /seo-settings` for that target, a
 * refusal under the input it names (in the viewer's language where `website.reasons` knows it)
 * or as the form's own message. A save resets the form to what the server kept.
 */
function useSeoEditor(target: SeoTarget, record: SeoSettingRecord, onSaved?: () => void) {
  const t = useTranslations("website.seo");
  const tCommon = useTranslations("common");
  const tReasons = useTranslations("website.reasons");
  const queryClient = useQueryClient();
  const invalidateWebsite = useInvalidateModule(WEBSITE_QUERY_MODULE);
  const tracker = useUploadTracker();
  const messages = useSchemaMessages();
  const schema = useMemo(() => seoFormSchema(messages), [messages]);
  const form = useForm<SeoFormValues>({
    resolver: zodResolver(schema),
    defaultValues: seoFormValues(record),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: async (values: SeoFormValues) => {
      try {
        return await Services.seoSettings.updateSeoSetting(target, buildSeoInput(values));
      } catch (failure) {
        throw withReasonText(failure, tReasons, SEO_REASON_SCOPE);
      }
    },
    knownFields: SEO_FORM_FIELDS,
    onSuccess: (saved) => {
      queryClient.setQueryData(seoQueryKey(target), saved);
      invalidateWebsite();
      form.reset(seoFormValues(saved));
      toast.success(t("saved"));
      onSaved?.();
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return {
    form,
    tracker,
    onSubmit: submitAfterUploads(tracker, handleSubmit),
    formError,
    isPending,
  };
}

/** The SEO inputs, each with its own message, so a server error lands under its input. */
function SeoFields({ form }: { form: UseFormReturn<SeoFormValues> }) {
  const t = useTranslations("website.seo");
  const textField = (
    name: "meta_title" | "canonical_url" | "robots",
    hint: string,
    dir?: "ltr",
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t(`fields.${name}`)}</FormLabel>
          <FormControl>
            <Input {...field} dir={dir} />
          </FormControl>
          <FormDescription>{hint}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <>
      {textField("meta_title", t("hints.meta_title"))}
      <FormField
        control={form.control}
        name="meta_description"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("fields.meta_description")}</FormLabel>
            <FormControl>
              <Textarea {...field} rows={3} />
            </FormControl>
            <FormDescription>{t("hints.meta_description")}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      <ImageFileField form={form} name="og_image_file_id" label={t("fields.og_image_file_id")} />
      {textField("canonical_url", t("hints.canonical_url"), "ltr")}
      {textField("robots", t("hints.robots"), "ltr")}
    </>
  );
}

function SeoLoading({ label }: { label: string }) {
  return (
    <div role="status" className="space-y-3">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-9 w-full" />
    </div>
  );
}

export interface SeoFormProps {
  target: SeoTarget;
  /** `website.seo.update`: without it the fields are read-only and there is no Save. */
  canUpdate: boolean;
}

/**
 * One target's SEO, inline: the site's own on the SEO screen. Loads the row, then the form with
 * its own Save. The editors of pages, posts, events and albums open the same form in
 * `SeoDialog`.
 */
export function SeoForm({ target, canUpdate }: SeoFormProps) {
  const t = useTranslations("website.seo");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const query = useSeoSetting(target);

  if (query.data)
    return <SeoInlineEditor target={target} record={query.data} canUpdate={canUpdate} />;
  if (query.isError) {
    return (
      <LoadErrorCard
        message={resolveErrorMessage(query.error, tErrors, t("loadError"))}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  return <SeoLoading label={tCommon("loading")} />;
}

function SaveBar({ tracker, isPending }: { tracker: UploadTracker; isPending: boolean }) {
  const tCommon = useTranslations("common");
  return (
    <div className="flex justify-end">
      <Button
        type="submit"
        disabled={tracker.isUploading}
        isLoading={isPending}
        loadingLabel={tCommon("saving")}
      >
        {tCommon("save")}
      </Button>
    </div>
  );
}

function SeoInlineEditor({
  target,
  record,
  canUpdate,
}: {
  target: SeoTarget;
  record: SeoSettingRecord;
  canUpdate: boolean;
}) {
  const { form, tracker, onSubmit, formError, isPending } = useSeoEditor(target, record);

  return (
    <UploadTrackerProvider value={tracker}>
      <Form {...form}>
        <form noValidate onSubmit={onSubmit} className="space-y-4">
          {formError && <Alert variant="destructive">{formError}</Alert>}
          <fieldset disabled={!canUpdate} className="space-y-4">
            <SeoFields form={form} />
          </fieldset>
          {canUpdate ? <SaveBar tracker={tracker} isPending={isPending} /> : null}
        </form>
      </Form>
    </UploadTrackerProvider>
  );
}

export interface SeoDialogProps {
  target: SeoTarget;
  /** The record's title, named in the dialog's own title. */
  title: string;
  onOpenChange: (open: boolean) => void;
}

/**
 * A page's, post's, event's or album's SEO in a dialog, opened from its editor (`SeoButton`).
 * The form mounts once the row is in, so it starts from the saved values.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is fresh.
 */
export function SeoDialog({ target, title, onOpenChange }: SeoDialogProps) {
  const t = useTranslations("website.seo");
  const query = useSeoSetting(target);
  const dialogTitle = t("dialogTitle", { title });

  if (!query.data) {
    return (
      <ContentFormPending
        open
        onOpenChange={onOpenChange}
        title={dialogTitle}
        error={query.error}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  return (
    <SeoDialogForm
      target={target}
      record={query.data}
      title={dialogTitle}
      onOpenChange={onOpenChange}
    />
  );
}

function SeoDialogForm({
  target,
  record,
  title,
  onOpenChange,
}: {
  target: SeoTarget;
  record: SeoSettingRecord;
  title: string;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("website.seo");
  const tCommon = useTranslations("common");
  const { form, tracker, onSubmit, formError, isPending } = useSeoEditor(target, record, () => {
    onOpenChange(false);
  });

  return (
    <UploadTrackerProvider value={tracker}>
      <FormDialogLayout
        open
        onOpenChange={onOpenChange}
        title={title}
        description={t("dialogIntro")}
        form={form}
        onSubmit={onSubmit}
        formError={formError}
        isPending={isPending}
        submittingLabel={tCommon("saving")}
        submitDisabled={tracker.isUploading}
      >
        <SeoFields form={form} />
      </FormDialogLayout>
    </UploadTrackerProvider>
  );
}
