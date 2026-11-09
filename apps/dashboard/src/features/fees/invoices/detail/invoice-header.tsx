"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";
import { ArrowLeft, Ban, Landmark, Wallet } from "lucide-react";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { Paths } from "@/config/paths";
import { useCurrentUser } from "@/hooks/use-current-user";
import { EMPTY_VALUE } from "@/lib/constants";
import { formatDate } from "@/lib/helpers";
import { hasPermission } from "@/lib/permissions";
import type { FeeInvoiceRecord } from "@/services";
import {
  isInvoiceCancelable,
  isInvoiceCollectible,
} from "@/services/modules/fee-invoices/fee-invoices-helper";
import { InvoiceStatusBadge } from "@/features/fees/shared/invoice-status-badge";
import { RecordPaymentDialog } from "@/features/fees/shared/record-payment-dialog";
import { useInvoiceReferences } from "@/features/fees/shared/use-invoice-references";
import { CancelInvoiceDialog } from "./cancel-invoice-dialog";
import { IssueVoucherDialog } from "./issue-voucher-dialog";

/**
 * The invoice's number, student, dates, scope and status, with Record payment, Issue voucher and
 * Cancel. Record payment and Issue voucher follow `fees.payment.collect` and show only while the
 * invoice can still take money. Cancel follows `fees.invoice.update` and shows only while nothing
 * is paid and the invoice is not already canceled; the server decides regardless (a 422, shown
 * in the dialog). A canceled invoice says why. Each dialog is mounted only while open.
 */
export function InvoiceHeader({ invoice }: { invoice: FeeInvoiceRecord }) {
  const t = useTranslations("fees");
  const locale = useLocale();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [voucherOpen, setVoucherOpen] = useState(false);
  const { names } = useInvoiceReferences();

  const { data: user } = useCurrentUser();
  const canCancel = hasPermission(user, "fees.invoice.update") && isInvoiceCancelable(invoice);
  const canCollect = hasPermission(user, "fees.payment.collect") && isInvoiceCollectible(invoice);

  return (
    <>
      <Toolbar>
        <ToolbarHeading
          title={t("invoices.detail.title", { number: invoice.invoice_no })}
          description={
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="font-medium text-foreground">{invoice.student_name}</span>
              <span>
                {invoice.fee_structure
                  ? (names.structures.get(invoice.fee_structure) ?? EMPTY_VALUE)
                  : t("invoices.adHoc")}
              </span>
              {invoice.period_label && <span>{invoice.period_label}</span>}
              <span>
                {t("invoices.detail.dates", {
                  issued: formatDate(invoice.issue_date, locale),
                  due: formatDate(invoice.due_date, locale),
                })}
              </span>
              <InvoiceStatusBadge status={invoice.status} />
            </div>
          }
        />
        <ToolbarActions>
          <Button variant="outline" asChild>
            <Link href={Paths.FEES_INVOICES}>
              <ArrowLeft className="rtl:rotate-180" aria-hidden="true" />
              {t("invoices.actions.backToList")}
            </Link>
          </Button>
          {canCollect && (
            <>
              <Button
                variant="primary"
                onClick={() => {
                  setRecordOpen(true);
                }}
              >
                <Wallet aria-hidden="true" />
                {t("invoices.actions.recordPayment")}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setVoucherOpen(true);
                }}
              >
                <Landmark aria-hidden="true" />
                {t("invoices.actions.issueVoucher")}
              </Button>
            </>
          )}
          {canCancel && (
            <Button
              variant="destructive"
              appearance="light"
              onClick={() => {
                setCancelOpen(true);
              }}
            >
              <Ban aria-hidden="true" />
              {t("invoices.actions.cancel")}
            </Button>
          )}
        </ToolbarActions>
      </Toolbar>
      {invoice.canceled_reason && (
        <p className="pb-4 text-sm text-muted-foreground">
          {t("invoices.detail.canceledBecause", { reason: invoice.canceled_reason })}
        </p>
      )}
      {cancelOpen && <CancelInvoiceDialog open onOpenChange={setCancelOpen} invoice={invoice} />}
      {recordOpen && <RecordPaymentDialog open onOpenChange={setRecordOpen} invoice={invoice} />}
      {voucherOpen && <IssueVoucherDialog open onOpenChange={setVoucherOpen} invoice={invoice} />}
    </>
  );
}
