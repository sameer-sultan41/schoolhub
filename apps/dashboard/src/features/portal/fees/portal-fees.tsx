"use client";

import Link from "next/link";
import { Badge, Card, CardContent, EmptyState, Skeleton } from "@schoolhub/ui";
import { Receipt } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { LoadErrorCard } from "@/components/load-error-card";
import { Paths } from "@/config/paths";
import { formatDate } from "@/lib/helpers";
import type { FeeInvoiceRecord, ReceiptRecord } from "@/services";
import { formatDecimal } from "@/features/portal/format-decimal";
import { ChildGate } from "@/features/portal/shell/child-gate";
import { FEE_STATUS_BADGE, FEE_STATUS_LABEL_KEY } from "./fee-status";
import { ReceiptDownloadButton } from "./receipt-download-button";
import { useChildInvoices, useReceiptsByInvoice } from "./use-fees-data";
import { enumBadge, enumLabel } from "@/features/portal/enum-label";

interface InvoiceListProps {
  kind: "outstanding" | "paid";
  studentId: string | undefined;
  receipts: ReadonlyMap<string, ReceiptRecord[]> | undefined;
}

function InvoiceList({ kind, studentId, receipts }: InvoiceListProps) {
  const t = useTranslations("portal.fees");
  const locale = useLocale();
  const query = useChildInvoices(studentId, kind);

  let content;
  if (query.isPending) {
    content = <Skeleton className="h-24 w-full" />;
  } else if (query.isError) {
    content = (
      <LoadErrorCard
        message={t("loadError")}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  } else if (query.data.length === 0) {
    content = (
      <EmptyState
        icon={Receipt}
        title={t(`${kind}.emptyTitle`)}
        description={t(`${kind}.emptyDescription`)}
      />
    );
  } else {
    content = (
      <ul className="divide-y divide-border">
        {query.data.map((invoice: FeeInvoiceRecord) => (
          <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="space-y-1">
              <Link
                href={Paths.PORTAL_INVOICE(invoice.student, invoice.id)}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                {invoice.invoice_no}
              </Link>
              <p className="text-xs text-muted-foreground">
                {[invoice.period_label, t("dueOn", { date: formatDate(invoice.due_date, locale) })]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <Badge
                variant={enumBadge(FEE_STATUS_BADGE, invoice.status, "secondary")}
                appearance="light"
                size="sm"
              >
                {enumLabel(t, FEE_STATUS_LABEL_KEY, invoice.status)}
              </Badge>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className="text-sm font-medium tabular-nums">
                {formatDecimal(
                  locale,
                  kind === "outstanding" ? invoice.balance_due : invoice.paid_total,
                )}
              </span>
              {kind === "paid"
                ? (receipts?.get(invoice.invoice_no) ?? []).map((receipt) => (
                    <ReceiptDownloadButton key={receipt.id} receipt={receipt} />
                  ))
                : null}
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-2">
        <h2 className="font-heading text-base font-semibold text-foreground">
          {t(`${kind}.title`)}
        </h2>
        {content}
      </CardContent>
    </Card>
  );
}

/** One child's fees: what is outstanding, what has been paid (with its receipts). Read-only:
 * there is no way to pay from here. */
export function PortalFees() {
  return <ChildGate>{(child) => <ChildFees studentId={child.student.id} />}</ChildGate>;
}

function ChildFees({ studentId }: { studentId: string }) {
  const t = useTranslations("portal.fees");
  const receipts = useReceiptsByInvoice();

  return (
    <section className="space-y-4">
      <h1 className="font-heading text-xl font-semibold text-foreground">{t("title")}</h1>
      {receipts.isError ? (
        <LoadErrorCard
          message={t("receiptsLoadError")}
          onRetry={() => {
            void receipts.refetch();
          }}
        />
      ) : null}
      <InvoiceList kind="outstanding" studentId={studentId} receipts={receipts.data} />
      <InvoiceList kind="paid" studentId={studentId} receipts={receipts.data} />
    </section>
  );
}
