"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
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
  Textarea,
} from "@schoolhub/ui";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { formatMoney } from "@/lib/format-decimal";
import type { PaymentRecord } from "@/services";
import { REFUND_REASON_MAX } from "@/services/modules/refunds/refunds-constant";
import {
  createRequestRefundFormSchema,
  type RequestRefundFormValues,
} from "@/services/modules/refunds/refunds.schema";
import { useRequestRefund } from "./use-request-refund";

export interface RequestRefundDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: PaymentRecord;
}

/**
 * Asks for money back against one confirmed payment: an amount and the reason. The amount starts
 * at the payment's own; what is still refundable is the server's to say, so an amount over it is
 * refused under the amount, and the remainder in the refusal's `meta` is stated beside it. One
 * `Idempotency-Key` per dialog instance (`useRequestRefund`). On success the form gives way to a
 * confirmation that the request now awaits an approver.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh form
 * and a fresh key.
 */
export function RequestRefundDialog({ open, onOpenChange, payment }: RequestRefundDialogProps) {
  const t = useTranslations("fees");
  const tCommon = useTranslations("common");
  const locale = useLocale();

  const schema = useMemo(
    () =>
      createRequestRefundFormSchema({
        required: tCommon("requiredField"),
        positive: t("invoices.refundDialog.positive"),
      }),
    [t, tCommon],
  );
  const form = useForm<RequestRefundFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { amount: payment.amount, reason: "" },
  });
  const request = useRequestRefund(form, payment.id);

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-lg" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {t("invoices.refundDialog.title", { receipt: payment.receipt_no })}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <Form {...form}>
          <form noValidate onSubmit={request.handleSubmit}>
            <ResponsiveDialogBody className="max-h-[65vh] space-y-4 overflow-y-auto pe-1">
              {request.refund ? (
                <Alert variant="success">
                  {t("invoices.refundDialog.requested", {
                    amount: formatMoney(locale, request.refund.amount),
                  })}
                </Alert>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    {t("invoices.refundDialog.intro", {
                      amount: formatMoney(locale, payment.amount),
                    })}
                  </p>
                  {request.formError && <Alert variant="destructive">{request.formError}</Alert>}
                  <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("invoices.refundDialog.amount")}</FormLabel>
                        <FormControl>
                          <Input type="text" inputMode="decimal" autoComplete="off" {...field} />
                        </FormControl>
                        {request.remainder !== null && (
                          <FormDescription>
                            {t("invoices.refundDialog.remainder", {
                              amount: formatMoney(locale, request.remainder),
                            })}
                          </FormDescription>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="reason"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("invoices.refundDialog.reason")}</FormLabel>
                        <FormControl>
                          <Textarea rows={3} maxLength={REFUND_REASON_MAX} {...field} />
                        </FormControl>
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
                {request.refund ? t("invoices.refundDialog.done") : tCommon("cancel")}
              </Button>
              {!request.refund && (
                <Button
                  type="submit"
                  isLoading={request.isPending}
                  loadingLabel={tCommon("saving")}
                >
                  {t("invoices.refundDialog.submit")}
                </Button>
              )}
            </ResponsiveDialogFooter>
          </form>
        </Form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
