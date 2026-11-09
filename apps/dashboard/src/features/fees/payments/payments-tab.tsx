"use client";

import { useTranslations } from "next-intl";
import { Wallet } from "lucide-react";
import { Input } from "@schoolhub/ui";

import { FilterSelect } from "@/components/filter-select";
import { useCurrentUser } from "@/hooks/use-current-user";
import { enumLabel } from "@/lib/enum-label";
import { hasPermission } from "@/lib/permissions";
import { Services } from "@/services";
import {
  CASHIER_FILTER_ME,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PAYMENTS_DEFAULT_SORTING,
  PAYMENTS_LIST_RESOURCE,
  PAYMENTS_PAGE_SIZE,
  PAYMENTS_QUERY_MODULE,
  PAYMENTS_SORT_FIELD,
  PAYMENTS_URL_FILTERS,
} from "@/services/modules/payments/payments-constant";
import {
  cashierFilterId,
  paidAtBounds,
  paymentMethodFilter,
  paymentStatusFilter,
} from "@/services/modules/payments/payments-helper";
import { filterToPick, pickToFilter } from "@/features/fees/shared/filter-values";
import {
  PAYMENT_METHOD_LABEL_KEY,
  PAYMENT_STATUS_LABEL_KEY,
} from "@/features/fees/shared/payment-labels";
import { useCollectionList } from "@/features/fees/shared/use-collection-list";
import { usePaymentColumns } from "./payment-columns";
import { PaymentsListCard } from "./payments-list-card";

/**
 * The Payments tab: every payment, filtered by method, status, a paid-on date range and cashier.
 * The cashier filter offers "My collections" (the daily register of the person at the counter);
 * a cashier's id from a link is honoured too, the record having no name to pick by. Read with
 * `fees.payment.view`; a row's invoice link needs `fees.invoice.view`.
 */
export function PaymentsTab() {
  const t = useTranslations("fees");
  const { data: user } = useCurrentUser();
  const columns = usePaymentColumns({ canOpenInvoice: hasPermission(user, "fees.invoice.view") });

  const { list, table, state, hasActiveFilter } = useCollectionList({
    columns,
    queryModule: PAYMENTS_QUERY_MODULE,
    listResource: PAYMENTS_LIST_RESOURCE,
    urlFilters: PAYMENTS_URL_FILTERS,
    sortField: PAYMENTS_SORT_FIELD,
    defaultSorting: PAYMENTS_DEFAULT_SORTING,
    pageSize: PAYMENTS_PAGE_SIZE,
    keyExtras: [user?.id ?? ""],
    fetchPage: ({ cursor, pageSize, ordering, filters }) =>
      Services.payments.listPayments({
        cursor,
        pageSize,
        ordering,
        method: paymentMethodFilter(filters.method),
        status: paymentStatusFilter(filters.status),
        ...paidAtBounds(filters.from, filters.to),
        receivedBy: cashierFilterId(filters.cashier, user?.id),
      }),
  });
  const { filters } = state;
  const cashierOptions = [
    { id: CASHIER_FILTER_ME, name: t("payments.payments.filters.cashierMe") },
    ...(filters.cashier !== "" && filters.cashier !== CASHIER_FILTER_ME
      ? [{ id: filters.cashier, name: t("payments.payments.filters.cashierLinked") }]
      : []),
  ];

  return (
    <PaymentsListCard
      list={list}
      table={table}
      scope="payments"
      icon={Wallet}
      hasActiveFilter={hasActiveFilter}
      filters={
        <>
          <FilterSelect
            label={t("payments.payments.filters.method")}
            allLabel={t("payments.filters.all")}
            value={filterToPick(filters.method)}
            onChange={(pick) => {
              state.setFilters({ method: pickToFilter(pick) });
            }}
            options={PAYMENT_METHODS.map((method) => ({
              id: method,
              name: enumLabel(t, PAYMENT_METHOD_LABEL_KEY, method),
            }))}
          />
          <FilterSelect
            label={t("payments.payments.filters.status")}
            allLabel={t("payments.filters.all")}
            value={filterToPick(filters.status)}
            onChange={(pick) => {
              state.setFilters({ status: pickToFilter(pick) });
            }}
            options={PAYMENT_STATUSES.map((status) => ({
              id: status,
              name: enumLabel(t, PAYMENT_STATUS_LABEL_KEY, status),
            }))}
          />
          <FilterSelect
            label={t("payments.payments.filters.cashier")}
            allLabel={t("payments.payments.filters.cashierAll")}
            value={filters.cashier}
            onChange={(pick) => {
              state.setFilters({ cashier: pick });
            }}
            options={cashierOptions}
          />
          <Input
            type="date"
            className="w-full sm:w-40"
            aria-label={t("payments.payments.filters.from")}
            value={filters.from}
            max={filters.to || undefined}
            onChange={(event) => {
              state.setFilters({ from: event.target.value });
            }}
          />
          <Input
            type="date"
            className="w-full sm:w-40"
            aria-label={t("payments.payments.filters.to")}
            value={filters.to}
            min={filters.from || undefined}
            onChange={(event) => {
              state.setFilters({ to: event.target.value });
            }}
          />
        </>
      }
    />
  );
}
