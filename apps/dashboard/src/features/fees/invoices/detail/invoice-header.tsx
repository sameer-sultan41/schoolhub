"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";
import { ArrowLeft, Ban } from "lucide-react";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { Paths } from "@/config/paths";
import { useCurrentUser } from "@/hooks/use-current-user";
import { EMPTY_VALUE } from "@/lib/constants";
import { formatDate } from "@/lib/helpers";
import { hasPermission } from "@/lib/permissions";
import type { FeeInvoiceRecord } from "@/services";
import { isInvoiceCancelable } from "@/services/modules/fee-invoices/fee-invoices-helper";
import { InvoiceStatusBadge } from "@/features/fees/shared/invoice-status-badge";
import { useInvoiceReferences } from "@/features/fees/shared/use-invoice-references";
import { CancelInvoiceDialog } from "./cancel-invoice-dialog";

/**
 * The invoice's number, student, dates, scope and status, and Cancel. Cancel follows
 * `fees.invoice.update` and shows only while nothing is paid and the invoice is not already
 * canceled; the server decides regardless (a 422, shown in the dialog). A canceled invoice
 * says why. The dialog is mounted only while open.
 */
export function InvoiceHeader({ invoice }: { invoice: FeeInvoiceRecord }) {
  const t = useTranslations("fees");
  const locale = useLocale();
  const [cancelOpen, setCancelOpen] = useState(false);
  const { names } = useInvoiceReferences();

  const { data: user } = useCurrentUser();
  const canCancel = hasPermission(user, "fees.invoice.update") && isInvoiceCancelable(invoice);

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
    </>
  );
}
