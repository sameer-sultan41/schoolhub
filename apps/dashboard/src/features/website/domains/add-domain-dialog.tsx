"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { FormControl, FormField, FormItem, FormLabel, FormMessage, Input } from "@schoolhub/ui";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type CustomDomainRecord } from "@/services";
import {
  customDomainFormSchema,
  type CustomDomainFormValues,
} from "@/services/modules/website/custom-domains/custom-domains.schema";
import { WEBSITE_QUERY_MODULE } from "@/services/shared/website-content";
import { withReasonText } from "@/features/website/shared/reason-message";
import { DOMAIN_REASON_SCOPE } from "./domain-labels";

const FIELDS = ["domain"] as const;

/**
 * Adds a domain. The form checks only that one was entered (trimmed); whether it is a valid
 * domain, the platform's own, already added or over the limit is the server's call, shown under
 * the field in the viewer's language. On success the caller shows the DNS records to add.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts empty.
 */
export function AddDomainDialog({
  onOpenChange,
  onAdded,
}: {
  onOpenChange: (open: boolean) => void;
  onAdded: (domain: CustomDomainRecord) => void;
}) {
  const t = useTranslations("website.domains.add");
  const tCommon = useTranslations("common");
  const tReasons = useTranslations("website.reasons");
  const invalidateWebsite = useInvalidateModule(WEBSITE_QUERY_MODULE);

  const schema = useMemo(
    () => customDomainFormSchema({ required: t("required"), tooLong: t("tooLong") }),
    [t],
  );
  const form = useForm<CustomDomainFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { domain: "" },
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: async (values: CustomDomainFormValues) => {
      try {
        return await Services.customDomains.createCustomDomain({ domain: values.domain });
      } catch (refusal) {
        throw withReasonText(refusal, tReasons, DOMAIN_REASON_SCOPE);
      }
    },
    knownFields: FIELDS,
    onSuccess: (domain) => {
      invalidateWebsite();
      onAdded(domain);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open
      onOpenChange={onOpenChange}
      title={t("title")}
      description={t("description")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={t("submitting")}
      submitLabel={t("submit")}
    >
      <FormField
        control={form.control}
        name="domain"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("label")}</FormLabel>
            <FormControl>
              <Input
                {...field}
                dir="ltr"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder={t("placeholder")}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormDialogLayout>
  );
}
