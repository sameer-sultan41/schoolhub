"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button, EmptyState, Skeleton } from "@schoolhub/ui";
import { FileText } from "lucide-react";

import { LoadErrorCard } from "@/components/load-error-card";
import { Paths } from "@/config/paths";
import { useCurrentUser } from "@/hooks/use-current-user";
import { resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { ApiError, Services } from "@/services";
import {
  FEE_INVOICES_DETAIL_RESOURCE,
  FEE_INVOICES_QUERY_MODULE,
} from "@/services/modules/fee-invoices/fee-invoices-constant";
import { InvoiceHeader } from "./invoice-header";
import { InvoiceLinesCard } from "./invoice-lines-card";
import { InvoicePaymentsCard } from "./invoice-payments-card";
import { InvoiceVouchersCard } from "./invoice-vouchers-card";

/**
 * One invoice: its header (number, student, status, Cancel), its lines with the server's totals,
 * then its payments (with their receipt numbers) and vouchers, read-only. Payments, receipts and
 * vouchers share one key, `fees.payment.view`, and are read only for a holder of it (L55): the
 * `principal` may open an invoice and see neither. An invoice the API can't find says so, with a
 * way back: the API answers 404 alike for another school's invoice and for one that does not
 * exist.
 */
export function InvoicePage({ invoiceId }: { invoiceId: string }) {
  const t = useTranslations("fees");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const { data: user } = useCurrentUser();
  const canViewPayments = hasPermission(user, "fees.payment.view");

  const query = useQuery({
    queryKey: queryKeys.detail(FEE_INVOICES_QUERY_MODULE, FEE_INVOICES_DETAIL_RESOURCE, invoiceId),
    queryFn: () => Services.feeInvoices.fetchFeeInvoice(invoiceId),
  });
  const { data: invoice, error, isPending } = query;

  if (invoice) {
    return (
      <>
        <InvoiceHeader invoice={invoice} />
        <div className="space-y-5">
          <InvoiceLinesCard invoice={invoice} />
          {canViewPayments && (
            <>
              <InvoicePaymentsCard invoiceId={invoice.id} />
              <InvoiceVouchersCard invoiceId={invoice.id} />
            </>
          )}
        </div>
      </>
    );
  }

  if (isPending) {
    return (
      <div role="status" className="space-y-4">
        <span className="sr-only">{tCommon("loading")}</span>
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error instanceof ApiError && error.isNotFound) {
    return (
      <EmptyState
        icon={FileText}
        title={t("invoices.detail.notFoundTitle")}
        description={t("invoices.detail.notFoundDescription")}
        action={
          <Button variant="outline" asChild>
            <Link href={Paths.FEES_INVOICES}>{t("invoices.actions.backToList")}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <LoadErrorCard
      message={resolveErrorMessage(error, tErrors, t("invoices.detail.loadError"))}
      onRetry={() => {
        void query.refetch();
      }}
    />
  );
}
