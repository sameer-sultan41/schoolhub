"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { Alert, Button, Form } from "@schoolhub/ui";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { defaultGenerateInvoicesFormValues } from "@/services/modules/fee-invoices/fee-invoices-helper";
import {
  createGenerateInvoicesFormSchema,
  type GenerateInvoicesFormValues,
} from "@/services/modules/fee-invoices/fee-invoices.schema";
import { GenerateInvoicesFields } from "./generate-invoices-fields";
import { GenerationResult } from "./generation-result";
import { useGenerateInvoices } from "./use-generate-invoices";

export interface GenerateInvoicesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Bills an active structure for one period, in the background: submitting answers `202` and the
 * dialog then watches the job and shows its created and skipped counts. Running it again for the
 * same period skips whoever is already billed, and says so. A refusal at the start (an inactive
 * structure) shows under its field or as the form's message.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh form.
 */
export function GenerateInvoicesDialog({ open, onOpenChange }: GenerateInvoicesDialogProps) {
  const t = useTranslations("fees");
  const tCommon = useTranslations("common");

  const schema = useMemo(
    () => createGenerateInvoicesFormSchema({ required: tCommon("requiredField") }),
    [tCommon],
  );
  const form = useForm<GenerateInvoicesFormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultGenerateInvoicesFormValues(),
  });
  const run = useGenerateInvoices(form);
  const isEnded = run.job !== undefined;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-lg" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("invoices.generate.title")}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <Form {...form}>
          <form noValidate onSubmit={run.handleSubmit}>
            <ResponsiveDialogBody className="max-h-[65vh] space-y-4 overflow-y-auto pe-1">
              {run.isStarted ? (
                <GenerationResult
                  job={run.job}
                  isRunning={run.isRunning}
                  isStalled={run.isStalled}
                  isPollRefused={run.isPollRefused}
                  progress={run.progress}
                  onResume={run.resume}
                />
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">{t("invoices.generate.intro")}</p>
                  {run.formError && <Alert variant="destructive">{run.formError}</Alert>}
                  <GenerateInvoicesFields form={form} />
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
                {run.isStarted ? tCommon("close") : tCommon("cancel")}
              </Button>
              {isEnded ? (
                <Button type="button" onClick={run.reset}>
                  {t("invoices.generate.another")}
                </Button>
              ) : (
                !run.isStarted && (
                  <Button type="submit" isLoading={run.isPending} loadingLabel={tCommon("saving")}>
                    {t("invoices.generate.submit")}
                  </Button>
                )
              )}
            </ResponsiveDialogFooter>
          </form>
        </Form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
