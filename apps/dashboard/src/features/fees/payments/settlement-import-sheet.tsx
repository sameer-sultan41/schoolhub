"use client";

import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import {
  Skeleton,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@schoolhub/ui";

import { LoadErrorCard } from "@/components/load-error-card";
import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetTitle,
} from "@/components/responsive-dialog";
import { EMPTY_VALUE } from "@/lib/constants";
import { enumLabel } from "@/lib/enum-label";
import { formatMoney } from "@/lib/format-decimal";
import { formatDate } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  SETTLEMENT_IMPORTS_DETAIL_RESOURCE,
  SETTLEMENT_IMPORTS_QUERY_MODULE,
} from "@/services/modules/settlement-imports/settlement-imports-constant";
import { settlementExceptions } from "@/services/modules/settlement-imports/settlement-imports-helper";
import { StatusBadge } from "@/features/fees/shared/status-badge";
import {
  SETTLEMENT_STATUS_BADGE,
  SETTLEMENT_STATUS_LABEL_KEY,
} from "@/features/fees/shared/settlement-labels";
import { VOUCHER_PROVIDER_LABEL_KEY } from "@/features/fees/shared/voucher-labels";

/** Re-read while the file is still being reconciled. */
const PROCESSING_POLL_MS = 2000;

export interface SettlementImportSheetProps {
  /** The import to show; the sheet is closed while `null`. */
  importId: string | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * One settlement import: its provider, status and counts (rows, matched, exceptions), and the
 * rows that did not post with the server's own reason each. Matched rows are a count only: the
 * API lists no posted rows. Read with `fees.payment.view`; re-read every couple of seconds
 * while the file is still processing.
 */
export function SettlementImportSheet({ importId, onOpenChange }: SettlementImportSheetProps) {
  const t = useTranslations("fees");
  const providerT = useTranslations("portal.fees");
  const tCommon = useTranslations("common");
  const locale = useLocale();

  const query = useQuery({
    queryKey: queryKeys.detail(
      SETTLEMENT_IMPORTS_QUERY_MODULE,
      SETTLEMENT_IMPORTS_DETAIL_RESOURCE,
      importId ?? "",
    ),
    queryFn: () => Services.settlementImports.fetchSettlementImport(importId ?? ""),
    enabled: importId !== null,
    refetchInterval: (latest) =>
      latest.state.data?.status === "processing" ? PROCESSING_POLL_MS : false,
  });
  const record = query.data;
  const exceptions = record ? settlementExceptions(record.exceptions) : [];

  return (
    <ResponsiveSheet open={importId !== null} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent className="sm:max-w-2xl" closeLabel={tCommon("close")}>
        <ResponsiveSheetTitle>{t("payments.imports.detail.title")}</ResponsiveSheetTitle>
        <ResponsiveSheetBody className="space-y-5">
          {query.isError ? (
            <LoadErrorCard
              message={t("payments.imports.detail.loadError")}
              onRetry={() => {
                void query.refetch();
              }}
            />
          ) : !record ? (
            <div role="status" className="space-y-3">
              <span className="sr-only">{tCommon("loading")}</span>
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">
                    {t("payments.imports.columns.provider")}
                  </dt>
                  <dd className="font-medium">
                    {enumLabel(providerT, VOUCHER_PROVIDER_LABEL_KEY, record.provider)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("payments.imports.columns.status")}</dt>
                  <dd>
                    <StatusBadge
                      status={record.status}
                      labels={SETTLEMENT_STATUS_LABEL_KEY}
                      variants={SETTLEMENT_STATUS_BADGE}
                    />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {t("payments.imports.columns.completed")}
                  </dt>
                  <dd className="font-medium">
                    {record.completed_at ? formatDate(record.completed_at, locale) : EMPTY_VALUE}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("payments.imports.columns.rows")}</dt>
                  <dd className="font-medium tabular-nums">{record.row_count}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("payments.imports.columns.matched")}</dt>
                  <dd className="font-medium tabular-nums">{record.matched_count}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {t("payments.imports.columns.exceptions")}
                  </dt>
                  <dd className="font-medium tabular-nums">{exceptions.length}</dd>
                </div>
              </dl>
              <section aria-labelledby="settlement-exceptions-title" className="space-y-2">
                <h3 id="settlement-exceptions-title" className="text-sm font-medium">
                  {t("payments.imports.detail.exceptionsTitle")}
                </h3>
                {exceptions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("payments.imports.detail.noExceptions")}
                  </p>
                ) : (
                  <Table>
                    <TableCaption className="sr-only">
                      {t("payments.imports.detail.caption")}
                    </TableCaption>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("payments.imports.detail.columns.row")}</TableHead>
                        <TableHead>{t("payments.imports.detail.columns.reference")}</TableHead>
                        <TableHead className="text-end">
                          {t("payments.imports.detail.columns.amount")}
                        </TableHead>
                        <TableHead>{t("payments.imports.detail.columns.reason")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {exceptions.map((exception, index) => (
                        <TableRow
                          key={`${String(exception.row)}-${exception.providerReference}-${String(index)}`}
                        >
                          <TableCell className="tabular-nums">{exception.row}</TableCell>
                          <TableCell>{exception.providerReference || EMPTY_VALUE}</TableCell>
                          <TableCell className="text-end tabular-nums">
                            {exception.amount ? formatMoney(locale, exception.amount) : EMPTY_VALUE}
                          </TableCell>
                          <TableCell className="whitespace-normal">{exception.reason}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </section>
            </>
          )}
        </ResponsiveSheetBody>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
