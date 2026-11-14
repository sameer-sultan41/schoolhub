"use client";

import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import {
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
import { Landmark } from "lucide-react";

import { LoadErrorCard } from "@/components/load-error-card";
import { enumLabel } from "@/lib/enum-label";
import { formatMoney } from "@/lib/format-decimal";
import { formatDate } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  VOUCHERS_BY_INVOICE_PAGE_SIZE,
  VOUCHERS_BY_INVOICE_RESOURCE,
  VOUCHERS_QUERY_MODULE,
} from "@/services/modules/vouchers/vouchers-constant";
import {
  VOUCHER_PROVIDER_LABEL_KEY,
  VOUCHER_STATUS_LABEL_KEY,
} from "@/features/fees/shared/voucher-labels";

/**
 * The bank vouchers issued for one invoice, read-only (issuing, voiding and downloading belong to
 * the later screens). The caller mounts it only for a holder of `fees.payment.view`, the key the
 * API gates vouchers on.
 */
export function InvoiceVouchersCard({ invoiceId }: { invoiceId: string }) {
  const t = useTranslations("fees");
  const providerT = useTranslations("portal.fees");
  const locale = useLocale();

  const query = useQuery({
    queryKey: queryKeys.list(VOUCHERS_QUERY_MODULE, VOUCHERS_BY_INVOICE_RESOURCE, { invoiceId }),
    queryFn: () =>
      Services.vouchers.listVouchers({
        invoice: invoiceId,
        pageSize: VOUCHERS_BY_INVOICE_PAGE_SIZE,
      }),
  });
  const vouchers = query.data?.items;

  return (
    <Card>
      <CardHeader>
        <CardHeading>
          <CardTitle>{t("invoices.vouchers.title")}</CardTitle>
        </CardHeading>
      </CardHeader>
      <CardContent className="p-0">
        {query.isError ? (
          <LoadErrorCard
            message={t("invoices.vouchers.loadError")}
            onRetry={() => {
              void query.refetch();
            }}
          />
        ) : !vouchers ? (
          <Skeleton className="m-5 h-16" />
        ) : vouchers.length === 0 ? (
          <EmptyState
            icon={Landmark}
            title={t("invoices.vouchers.emptyTitle")}
            description={t("invoices.vouchers.emptyDescription")}
          />
        ) : (
          <Table>
            <TableCaption className="sr-only">{t("invoices.vouchers.caption")}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{t("invoices.vouchers.columns.provider")}</TableHead>
                <TableHead>{t("invoices.vouchers.columns.consumer")}</TableHead>
                <TableHead>{t("invoices.vouchers.columns.due")}</TableHead>
                <TableHead>{t("invoices.vouchers.columns.status")}</TableHead>
                <TableHead className="text-end">{t("invoices.vouchers.columns.amount")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vouchers.map((voucher) => (
                <TableRow key={voucher.id}>
                  <TableCell className="font-medium">
                    {enumLabel(providerT, VOUCHER_PROVIDER_LABEL_KEY, voucher.provider)}
                  </TableCell>
                  <TableCell className="tabular-nums">{voucher.consumer_number}</TableCell>
                  <TableCell>{formatDate(voucher.due_date, locale)}</TableCell>
                  <TableCell>{enumLabel(t, VOUCHER_STATUS_LABEL_KEY, voucher.status)}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatMoney(locale, voucher.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
