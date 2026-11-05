"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Badge, Card, CardContent, EmptyState, Skeleton } from "@schoolhub/ui";
import { Receipt } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { LoadErrorCard } from "@/components/load-error-card";
import { Paths } from "@/config/paths";
import { formatDate } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import { PARENT_PORTAL_QUERY_MODULE } from "@/services/modules/parent-portal/parent-portal-constant";
import { formatDecimal } from "@/features/portal/format-decimal";
import { FEE_STATUS_BADGE, FEE_STATUS_LABEL_KEY } from "./fee-status";
import { ReceiptDownloadButton } from "./receipt-download-button";
import { useReceiptsByInvoice } from "./use-fees-data";

/** One invoice with its lines, the totals the server computed, and its receipts. */
export function PortalInvoiceDetail() {
  const t = useTranslations("portal.fees");
  const locale = useLocale();
  const { studentId, invoiceId } = useParams<{ studentId: string; invoiceId: string }>();
  const receipts = useReceiptsByInvoice();
  const query = useQuery({
    queryKey: queryKeys.detail(PARENT_PORTAL_QUERY_MODULE, "invoice", invoiceId),
    queryFn: () => Services.feeInvoices.fetchFeeInvoice(invoiceId),
  });

  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  if (query.isError || query.data.student !== studentId) {
    return (
      <LoadErrorCard
        message={t("detail.loadError")}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  const invoice = query.data;
  const invoiceReceipts = receipts.data?.get(invoice.invoice_no) ?? [];
  const money = (value: string) => formatDecimal(locale, value);
  const totals: [string, string][] = [
    [t("detail.subtotal"), invoice.subtotal],
    [t("detail.discount"), invoice.discount_total],
    [t("detail.fine"), invoice.fine_total],
    [t("detail.paid"), invoice.paid_total],
    [t("detail.balance"), invoice.balance_due],
  ];

  return (
    <section className="space-y-4">
      <Link
        href={Paths.PORTAL_FEES(studentId)}
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        {t("detail.back")}
      </Link>
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="font-heading text-xl font-semibold text-foreground">
              {t("detail.title", { number: invoice.invoice_no })}
            </h1>
            <Badge variant={FEE_STATUS_BADGE[invoice.status]} appearance="light">
              {t(FEE_STATUS_LABEL_KEY[invoice.status])}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {t("detail.dates", {
              issued: formatDate(invoice.issue_date, locale),
              due: formatDate(invoice.due_date, locale),
            })}
          </p>
          <table className="w-full text-sm">
            <caption className="sr-only">{t("detail.linesCaption")}</caption>
            <thead>
              <tr className="text-start text-muted-foreground">
                <th scope="col" className="py-2 text-start font-medium">
                  {t("detail.description")}
                </th>
                <th scope="col" className="py-2 text-end font-medium">
                  {t("detail.amount")}
                </th>
                <th scope="col" className="py-2 text-end font-medium">
                  {t("detail.net")}
                </th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => (
                <tr key={line.id} className="border-t border-border">
                  <td className="py-2">{line.description}</td>
                  <td className="py-2 text-end tabular-nums">{money(line.amount)}</td>
                  <td className="py-2 text-end tabular-nums">
                    {formatDecimal(locale, String(line.net_amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="ms-auto grid max-w-xs grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {totals.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-end tabular-nums">{money(value)}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3">
          <h2 className="font-heading text-base font-semibold text-foreground">
            {t("detail.receipts")}
          </h2>
          {receipts.isError ? (
            <LoadErrorCard
              message={t("receiptsLoadError")}
              onRetry={() => {
                void receipts.refetch();
              }}
            />
          ) : invoiceReceipts.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title={t("detail.noReceiptsTitle")}
              description={t("detail.noReceiptsDescription")}
            />
          ) : (
            invoiceReceipts.map((receipt) => (
              <ReceiptDownloadButton key={receipt.id} receipt={receipt} />
            ))
          )}
        </CardContent>
      </Card>
    </section>
  );
}
