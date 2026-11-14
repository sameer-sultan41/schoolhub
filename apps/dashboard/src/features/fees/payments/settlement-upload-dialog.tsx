"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
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
} from "@schoolhub/ui";

import { FormSelectField } from "@/components/form-select-field";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { enumLabel } from "@/lib/enum-label";
import { SETTLEMENT_FILE_ACCEPT } from "@/services/modules/settlement-imports/settlement-imports-constant";
import {
  createSettlementUploadFormSchema,
  defaultSettlementUploadFormValues,
  type SettlementUploadFormValues,
} from "@/services/modules/settlement-imports/settlement-imports.schema";
import { VOUCHER_PROVIDERS } from "@/services/modules/vouchers/vouchers-constant";
import { VOUCHER_PROVIDER_LABEL_KEY } from "@/features/fees/shared/voucher-labels";
import { SettlementUploadResult } from "./settlement-upload-result";
import { useSettlementUpload } from "./use-settlement-upload";

export interface SettlementUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Uploads a provider's settlement file to reconcile: the provider and the CSV go as multipart,
 * the server answers `202` and the dialog then watches the job and shows its matched and
 * exception counts. One `Idempotency-Key` per dialog instance (`useSettlementUpload`). A refusal
 * at the start (no file, an unknown provider) shows under its field or as the form's message.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh form
 * and a fresh key.
 */
export function SettlementUploadDialog({ open, onOpenChange }: SettlementUploadDialogProps) {
  const t = useTranslations("fees");
  const providerT = useTranslations("portal.fees");
  const tCommon = useTranslations("common");

  const schema = useMemo(
    () => createSettlementUploadFormSchema({ required: tCommon("requiredField") }),
    [tCommon],
  );
  const form = useForm<SettlementUploadFormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultSettlementUploadFormValues(),
  });
  const upload = useSettlementUpload(form);

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-lg" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("payments.imports.upload.title")}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <Form {...form}>
          <form noValidate onSubmit={upload.handleSubmit}>
            <ResponsiveDialogBody className="max-h-[65vh] space-y-4 overflow-y-auto pe-1">
              {upload.isStarted ? (
                <SettlementUploadResult
                  job={upload.job}
                  isRunning={upload.isRunning}
                  isStalled={upload.isStalled}
                  isPollRefused={upload.isPollRefused}
                  progress={upload.progress}
                  onResume={upload.resume}
                />
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    {t("payments.imports.upload.intro")}
                  </p>
                  {upload.formError && <Alert variant="destructive">{upload.formError}</Alert>}
                  <FormSelectField
                    form={form}
                    name="provider"
                    label={t("payments.imports.upload.provider")}
                    placeholder={t("payments.imports.upload.provider")}
                    options={VOUCHER_PROVIDERS.map((id) => ({
                      id,
                      name: enumLabel(providerT, VOUCHER_PROVIDER_LABEL_KEY, id),
                    }))}
                  />
                  <FormField
                    control={form.control}
                    name="file"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("payments.imports.upload.file")}</FormLabel>
                        <FormControl>
                          <Input
                            type="file"
                            accept={SETTLEMENT_FILE_ACCEPT}
                            name={field.name}
                            ref={field.ref}
                            onBlur={field.onBlur}
                            onChange={(event) => {
                              field.onChange(event.target.files?.[0] ?? null);
                            }}
                          />
                        </FormControl>
                        <FormDescription>{t("payments.imports.upload.fileHint")}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}
            </ResponsiveDialogBody>
            <ResponsiveDialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                }}
              >
                {upload.isStarted ? t("payments.imports.upload.done") : tCommon("cancel")}
              </Button>
              {!upload.isStarted && (
                <Button type="submit" isLoading={upload.isPending} loadingLabel={tCommon("saving")}>
                  {t("payments.imports.upload.submit")}
                </Button>
              )}
            </ResponsiveDialogFooter>
          </form>
        </Form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
