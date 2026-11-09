"use client";

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
import { formatMoney } from "@/lib/format-decimal";
import { formatDate } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import { Services, type FeeInvoiceRecord } from "@/services";
import {
  FEE_INVOICES_COUNTER_PAGE_SIZE,
  FEE_INVOICES_COUNTER_RESOURCE,
  FEE_INVOICES_QUERY_MODULE,
} from "@/services/modules/fee-invoices/fee-invoices-constant";
import { InvoiceStatusBadge } from "@/features/fees/shared/invoice-status-badge";

export interface OutstandingInvoicesCardProps {
  studentId: string;
  studentName: string;
  /** Record is offered only to a holder of `fees.payment.collect`. */
  onRecord?: (invoice: FeeInvoiceRecord) => void;
}

/**
 * One student's invoices that still owe money (`/fee-invoices?student=&outstanding=true`), oldest
 * due first, with the server's own balances. A student has a handful, so one page is the whole
 * list. The caller mounts it only for a holder of `fees.invoice.view` (L59).
 */
export function OutstandingInvoicesCard({
  studentId,
  studentName,
  onRecord,
}: OutstandingInvoicesCardProps) {
  const t = useTranslations("fees");
  const locale = useLocale();

  const query = useQuery({
    queryKey: queryKeys.list(FEE_INVOICES_QUERY_MODULE, FEE_INVOICES_COUNTER_RESOURCE, {
      studentId,
    }),
    queryFn: () =>
      Services.feeInvoices.listFeeInvoices({
        studentId,
        outstanding: true,
        ordering: "due_date",
        pageSize: FEE_INVOICES_COUNTER_PAGE_SIZE,
      }),
  });
  const invoices = query.data?.items;

  return (
    <Card>
      <CardHeader>
        <CardHeading>
          <CardTitle>{t("counter.invoices.title", { name: studentName })}</CardTitle>
        </CardHeading>
      </CardHeader>
      <CardContent className="p-0">
        {query.isError ? (
          <LoadErrorCard
            message={t("counter.invoices.loadError")}
            onRetry={() => {
              void query.refetch();
            }}
          />
        ) : !invoices ? (
          <Skeleton className="m-5 h-16" />
        ) : invoices.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title={t("counter.invoices.emptyTitle")}
            description={t("counter.invoices.emptyDescription", { name: studentName })}
          />
        ) : (
          <Table>
            <TableCaption className="sr-only">{t("counter.invoices.caption")}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{t("counter.invoices.columns.number")}</TableHead>
                <TableHead>{t("counter.invoices.columns.period")}</TableHead>
                <TableHead>{t("counter.invoices.columns.due")}</TableHead>
                <TableHead>{t("counter.invoices.columns.status")}</TableHead>
                <TableHead className="text-end">{t("counter.invoices.columns.balance")}</TableHead>
                {onRecord && (
                  <TableHead>
                    <span className="sr-only">{t("counter.invoices.columns.actions")}</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell className="font-medium">{invoice.invoice_no}</TableCell>
                  <TableCell>{invoice.period_label || EMPTY_VALUE}</TableCell>
                  <TableCell>{formatDate(invoice.due_date, locale)}</TableCell>
                  <TableCell>
                    <InvoiceStatusBadge status={invoice.status} />
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatMoney(locale, invoice.balance_due)}
                  </TableCell>
                  {onRecord && (
                    <TableCell className="text-end">
                      <Button
                        variant="primary"
                        size="sm"
                        aria-label={t("counter.invoices.recordFor", { number: invoice.invoice_no })}
                        onClick={() => {
                          onRecord(invoice);
                        }}
                      >
                        {t("counter.invoices.record")}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
