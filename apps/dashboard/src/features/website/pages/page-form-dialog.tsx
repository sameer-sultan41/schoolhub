"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Switch,
} from "@schoolhub/ui";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { FormSelectField } from "@/components/form-select-field";
import { websitePagePath } from "@/config/paths";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type WebsitePageRecord } from "@/services";
import {
  CREATABLE_PAGE_TYPES,
  HOME_PAGE_TYPE,
  PAGE_ERROR_FIELDS,
  PAGE_SLUG_MAX_LENGTH,
  PAGE_TITLE_MAX_LENGTH,
} from "@/services/modules/website/website-pages/website-pages-constant";
import {
  buildPageCreateInput,
  buildPageUpdateInput,
  pageFormValues,
} from "@/services/modules/website/website-pages/website-pages-helper";
import {
  createPageFormSchema,
  type PageFormValues,
} from "@/services/modules/website/website-pages/website-pages.schema";
import { WEBSITE_QUERY_MODULE } from "@/services/shared/website-content";
import { withReasonText } from "@/features/website/shared/reason-message";
import { usePageTypeLabel } from "./page-type-label";

export interface PageFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The page whose details to edit; omitted to create one (then opened in its editor). */
  page?: WebsitePageRecord;
}

/**
 * A page's details: title, address, type (on create only; a page's type fixes its role) and
 * whether search engines may list it. The home page keeps its address (it is served at `/`),
 * and no other page may take `home` or a type the site already has (`home`). A refusal names
 * its field (`reserved_slug`, `slug_taken` under the address) and is translated.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh
 * form.
 */
export function PageFormDialog({ open, onOpenChange, page }: PageFormDialogProps) {
  const t = useTranslations("website.pages");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("website.schemaFields.errors");
  const tReasons = useTranslations("website.reasons");
  const router = useRouter();
  const typeLabel = usePageTypeLabel();
  const invalidateWebsite = useInvalidateModule(WEBSITE_QUERY_MODULE);
  const isHomePage = page?.page_type === HOME_PAGE_TYPE;

  const schema = useMemo(
    () =>
      createPageFormSchema(
        {
          required: tCommon("requiredField"),
          tooLong: (max) => tErrors("tooLong", { max }),
          slugInvalid: t("form.slugInvalid"),
          slugReserved: tReasons("reserved_slug"),
        },
        isHomePage,
      ),
    [t, tCommon, tErrors, tReasons, isHomePage],
  );
  const form = useForm<PageFormValues>({
    resolver: zodResolver(schema),
    defaultValues: pageFormValues(page),
  });

  // Only the inputs this form renders: an error on another field is the form's own message.
  const knownFields = PAGE_ERROR_FIELDS.filter(
    (field) => !(field === "slug" && isHomePage) && !(field === "page_type" && page),
  );
  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: async (values: PageFormValues) => {
      try {
        return page
          ? await Services.websitePages.updateWebsitePage(
              page.id,
              buildPageUpdateInput(values, page),
            )
          : await Services.websitePages.createWebsitePage(buildPageCreateInput(values));
      } catch (refusal) {
        throw withReasonText(refusal, tReasons);
      }
    },
    knownFields,
    onSuccess: (saved) => {
      invalidateWebsite();
      toast.success(page ? t("saved") : t("created"));
      onOpenChange(false);
      if (!page) router.push(websitePagePath(saved.id));
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  const typeOptions = CREATABLE_PAGE_TYPES.map((type) => ({ id: type, name: typeLabel(type) }));

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={page ? t("form.editTitle") : t("form.createTitle")}
      description={t("form.intro")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
    >
      <FormField
        control={form.control}
        name="title"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("form.title")}</FormLabel>
            <FormControl required>
              <Input {...field} maxLength={PAGE_TITLE_MAX_LENGTH} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      {isHomePage ? (
        <p className="text-sm text-muted-foreground">{t("form.homeAddress")}</p>
      ) : (
        <FormField
          control={form.control}
          name="slug"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("form.slug")}</FormLabel>
              <FormControl required>
                <Input {...field} dir="ltr" maxLength={PAGE_SLUG_MAX_LENGTH} />
              </FormControl>
              <FormDescription>{t("form.slugHint")}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
      {page ? null : (
        <FormSelectField
          form={form}
          name="page_type"
          label={t("form.type")}
          placeholder={t("form.type")}
          options={typeOptions}
        />
      )}
      <FormField
        control={form.control}
        name="show_in_search"
        render={({ field }) => (
          <FormItem>
            <div className="flex items-center justify-between gap-3">
              <FormLabel>{t("form.showInSearch")}</FormLabel>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormDialogLayout>
  );
}
