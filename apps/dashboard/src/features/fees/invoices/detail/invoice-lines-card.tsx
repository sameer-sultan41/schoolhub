"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardHeader,
  CardHeading,
  CardTitle,
  EmptyState,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@schoolhub/ui";
import { Receipt } from "lucide-react";

import { enumLabel } from "@/lib/enum-label";
import { formatMoney } from "@/lib/format-decimal";
import type { FeeInvoiceRecord } from "@/services";
import { INVOICE_LINE_SOURCE_LABEL_KEY } from "@/features/fees/shared/invoice-labels";

/**
 * The invoice's lines and the server's totals. A line shows its charge, the discount taken off
 * it and its net; a fine billed on this invoice is a line of its own, marked by its source. The
 * totals under the lines (subtotal, discounts, fines, paid, balance due) are the server's own
 * fields, never summed here. Discounts and fines come with the invoice itself, so this card
 * needs no key beyond `fees.invoice.view`.
 */
export function InvoiceLinesCard({ invoice }: { invoice: FeeInvoiceRecord }) {
  const t = useTranslations("fees");
  const locale = useLocale();
  const money = (value: string) => formatMoney(locale, value);

  const totals: { label: string; value: string; strong?: boolean }[] = [
    { label: t("invoices.detail.subtotal"), value: invoice.subtotal },
    { label: t("invoices.detail.discounts"), value: invoice.discount_total },
    { label: t("invoices.detail.fines"), value: invoice.fine_total },
    { label: t("invoices.detail.paid"), value: invoice.paid_total },
    { label: t("invoices.detail.balance"), value: invoice.balance_due, strong: true },
  ];

  return (
    <Card>
      <CardHeader>
        <CardHeading>
          <CardTitle>{t("invoices.detail.linesTitle")}</CardTitle>
        </CardHeading>
      </CardHeader>
      <CardContent className="p-0">
        {invoice.lines.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={t("invoices.detail.noLinesTitle")}
            description={t("invoices.detail.noLinesDescription")}
          />
        ) : (
          <Table>
            <TableCaption className="sr-only">{t("invoices.detail.linesCaption")}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{t("invoices.detail.description")}</TableHead>
                <TableHead>{t("invoices.detail.source.label")}</TableHead>
                <TableHead className="text-end">{t("invoices.detail.amount")}</TableHead>
                <TableHead className="text-end">{t("invoices.detail.discount")}</TableHead>
                <TableHead className="text-end">{t("invoices.detail.net")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell className="font-medium">
                    {line.description}
                    <span className="ms-2 text-xs text-muted-foreground">{line.fee_head_code}</span>
                  </TableCell>
                  <TableCell>
                    {enumLabel(t, INVOICE_LINE_SOURCE_LABEL_KEY, line.source_type)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{money(line.amount)}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {money(line.discount_amount)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {money(String(line.net_amount))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              {totals.map(({ label, value, strong }) => (
                <TableRow key={label}>
                  <TableCell colSpan={4} className={strong ? "text-end font-semibold" : "text-end"}>
                    {label}
                  </TableCell>
                  <TableCell
                    className={
                      strong ? "text-end font-semibold tabular-nums" : "text-end tabular-nums"
                    }
                  >
                    {money(value)}
                  </TableCell>
                </TableRow>
              ))}
            </TableFooter>
          </Table>
        )}
        {invoice.lines.length === 0 && (
          <dl className="grid grid-cols-2 gap-2 border-t p-5 text-sm sm:grid-cols-5">
            {totals.map(({ label, value }) => (
              <div key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="tabular-nums">{money(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
