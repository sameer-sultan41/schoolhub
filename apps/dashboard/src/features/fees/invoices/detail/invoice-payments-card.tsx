"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardHeading,
  CardTitle,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@schoolhub/ui";
import { Wallet } from "lucide-react";

import { LoadErrorCard } from "@/components/load-error-card";
import { EMPTY_VALUE } from "@/lib/constants";
import { enumLabel } from "@/lib/enum-label";
import { formatMoney } from "@/lib/format-decimal";
import { formatDate } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { Services, type PaymentRecord } from "@/services";
import {
  PAYMENTS_BY_INVOICE_PAGE_SIZE,
  PAYMENTS_BY_INVOICE_RESOURCE,
  PAYMENTS_QUERY_MODULE,
} from "@/services/modules/payments/payments-constant";
import {
  PAYMENT_METHOD_LABEL_KEY,
  PAYMENT_STATUS_LABEL_KEY,
} from "@/features/fees/shared/payment-labels";
import { RequestRefundDialog } from "./request-refund-dialog";

/**
 * The payments made against one invoice, each with its receipt number. Request refund follows
 * `fees.payment.refund` and shows only on a confirmed payment (the server refuses any other, and
 * an over-limit amount); the dialog is mounted only while open. Downloading a receipt is the
 * Payments page's. The caller mounts it only for a holder of `fees.payment.view`.
 */
export function InvoicePaymentsCard({ invoiceId }: { invoiceId: string }) {
  const t = useTranslations("fees");
  const locale = useLocale();
  const { data: user } = useCurrentUser();
  const canRefund = hasPermission(user, "fees.payment.refund");
  const [refundTarget, setRefundTarget] = useState<PaymentRecord | null>(null);

  const query = useQuery({
    queryKey: queryKeys.list(PAYMENTS_QUERY_MODULE, PAYMENTS_BY_INVOICE_RESOURCE, { invoiceId }),
    queryFn: () =>
      Services.payments.listPayments({ invoiceId, pageSize: PAYMENTS_BY_INVOICE_PAGE_SIZE }),
  });
  const payments = query.data?.items;

  return (
    <>
      <Card>
        <CardHeader>
          <CardHeading>
            <CardTitle>{t("invoices.payments.title")}</CardTitle>
          </CardHeading>
        </CardHeader>
        <CardContent className="p-0">
          {query.isError ? (
            <LoadErrorCard
              message={t("invoices.payments.loadError")}
              onRetry={() => {
                void query.refetch();
              }}
            />
          ) : !payments ? (
            <Skeleton className="m-5 h-16" />
          ) : payments.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title={t("invoices.payments.emptyTitle")}
              description={t("invoices.payments.emptyDescription")}
            />
          ) : (
            <Table>
              <TableCaption className="sr-only">{t("invoices.payments.caption")}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("invoices.payments.columns.receipt")}</TableHead>
                  <TableHead>{t("invoices.payments.columns.paidAt")}</TableHead>
                  <TableHead>{t("invoices.payments.columns.method")}</TableHead>
                  <TableHead>{t("invoices.payments.columns.status")}</TableHead>
                  <TableHead className="text-end">
                    {t("invoices.payments.columns.amount")}
                  </TableHead>
                  {canRefund && (
                    <TableHead>
                      <span className="sr-only">{t("invoices.payments.columns.actions")}</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell className="font-medium">
                      {payment.receipt_no || EMPTY_VALUE}
                    </TableCell>
                    <TableCell>
                      {payment.paid_at ? formatDate(payment.paid_at, locale) : EMPTY_VALUE}
                    </TableCell>
                    <TableCell>{enumLabel(t, PAYMENT_METHOD_LABEL_KEY, payment.method)}</TableCell>
                    <TableCell>{enumLabel(t, PAYMENT_STATUS_LABEL_KEY, payment.status)}</TableCell>
                    <TableCell className="text-end tabular-nums">
                      {formatMoney(locale, payment.amount)}
                    </TableCell>
                    {canRefund && (
                      <TableCell className="text-end">
                        {payment.status === "confirmed" && (
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={t("invoices.payments.requestRefundRow", {
                              receipt: payment.receipt_no,
                            })}
                            onClick={() => {
                              setRefundTarget(payment);
                            }}
                          >
                            {t("invoices.payments.requestRefund")}
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {refundTarget && (
        <RequestRefundDialog
          open
          payment={refundTarget}
          onOpenChange={(open) => {
            if (!open) setRefundTarget(null);
          }}
        />
      )}
    </>
  );
}
