"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Undo2 } from "lucide-react";

import { FilterSelect } from "@/components/filter-select";
import { useCurrentUser } from "@/hooks/use-current-user";
import { enumLabel } from "@/lib/enum-label";
import { hasPermission } from "@/lib/permissions";
import { Services, type RefundRecord } from "@/services";
import {
  REFUND_STATUSES,
  REFUNDS_DEFAULT_SORTING,
  REFUNDS_LIST_RESOURCE,
  REFUNDS_PAGE_SIZE,
  REFUNDS_QUERY_MODULE,
  REFUNDS_SORT_FIELD,
  REFUNDS_URL_FILTERS,
  type RefundDecision,
} from "@/services/modules/refunds/refunds-constant";
import { refundStatusFilter } from "@/services/modules/refunds/refunds-helper";
import { filterToPick, pickToFilter } from "@/features/fees/shared/filter-values";
import { REFUND_STATUS_LABEL_KEY } from "@/features/fees/shared/refund-labels";
import { useCollectionList } from "@/features/fees/shared/use-collection-list";
import { PaymentsListCard } from "./payments-list-card";
import { ProcessRefundDialog } from "./process-refund-dialog";
import { RefundDecisionDialog } from "./refund-decision-dialog";
import { useRefundColumns } from "./refund-columns";

type RefundAction = { refund: RefundRecord; kind: RefundDecision | "process" };

/**
 * The Refunds tab: every refund request, filtered by status. Requesting one is from the payment
 * on an invoice's page. Approve, Reject and Process follow `fees.refund.approve`; Approve and
 * Reject are hidden on a refund the viewer requested (the server's 422 still shows if one gets
 * through). Each dialog is mounted only while open.
 */
export function RefundsTab() {
  const t = useTranslations("fees");
  const [action, setAction] = useState<RefundAction | null>(null);
  const { data: user } = useCurrentUser();
  const canApprove = hasPermission(user, "fees.refund.approve");

  const onApprove = useCallback((refund: RefundRecord) => {
    setAction({ refund, kind: "approve" });
  }, []);
  const onReject = useCallback((refund: RefundRecord) => {
    setAction({ refund, kind: "reject" });
  }, []);
  const onProcess = useCallback((refund: RefundRecord) => {
    setAction({ refund, kind: "process" });
  }, []);
  const columns = useRefundColumns({
    canApprove,
    currentUserId: user?.id,
    onApprove,
    onReject,
    onProcess,
  });

  const { list, table, state, hasActiveFilter } = useCollectionList({
    columns,
    queryModule: REFUNDS_QUERY_MODULE,
    listResource: REFUNDS_LIST_RESOURCE,
    urlFilters: REFUNDS_URL_FILTERS,
    sortField: REFUNDS_SORT_FIELD,
    defaultSorting: REFUNDS_DEFAULT_SORTING,
    pageSize: REFUNDS_PAGE_SIZE,
    fetchPage: ({ cursor, pageSize, ordering, filters }) =>
      Services.refunds.listRefunds({
        cursor,
        pageSize,
        ordering,
        status: refundStatusFilter(filters.status),
      }),
  });

  const close = (open: boolean) => {
    if (!open) setAction(null);
  };

  return (
    <>
      <PaymentsListCard
        list={list}
        table={table}
        scope="refunds"
        icon={Undo2}
        hasActiveFilter={hasActiveFilter}
        filters={
          <FilterSelect
            label={t("payments.refunds.filters.status")}
            allLabel={t("payments.filters.all")}
            value={filterToPick(state.filters.status)}
            onChange={(pick) => {
              state.setFilters({ status: pickToFilter(pick) });
            }}
            options={REFUND_STATUSES.map((status) => ({
              id: status,
              name: enumLabel(t, REFUND_STATUS_LABEL_KEY, status),
            }))}
          />
        }
      />
      {action && action.kind !== "process" && (
        <RefundDecisionDialog
          open
          onOpenChange={close}
          refund={action.refund}
          decision={action.kind}
        />
      )}
      {action?.kind === "process" && (
        <ProcessRefundDialog open onOpenChange={close} refund={action.refund} />
      )}
    </>
  );
}
