"use client";

import { useTranslations } from "next-intl";
import { Label, Switch } from "@schoolhub/ui";

import { FilterSelect } from "@/components/filter-select";
import { SearchInput } from "@/components/search-input";
import { FILTER_ALL } from "@/lib/constants";
import { enumLabel } from "@/lib/enum-label";
import {
  FEE_INVOICE_STATUSES,
  OUTSTANDING_OFF,
  OUTSTANDING_ON,
} from "@/services/modules/fee-invoices/fee-invoices-constant";
import { FEE_STATUS_LABEL_KEY } from "@/features/fees/shared/fee-status";
import { useInvoiceReferences } from "@/features/fees/shared/use-invoice-references";

/** The URL filter keys this component writes (`FEE_INVOICES_URL_FILTERS`). */
export interface InvoiceFilterValues {
  session: string;
  structure: string;
  student: string;
  status: string;
  outstanding: string;
}

export interface InvoiceFiltersProps {
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  values: InvoiceFilterValues;
  onChange: (changes: Partial<InvoiceFilterValues>) => void;
}

const toPick = (filter: string) => (filter === FILTER_ALL ? "" : filter);
const toFilter = (pick: string) => (pick === "" ? FILTER_ALL : pick);

/**
 * The invoices list's search box (invoice number or student name), session, structure and status
 * filters, and the Defaulters switch (`?outstanding=true`: everything still owing money). A scope
 * filter reads its own list, so it shows only to a holder of that list's view key (L55). The
 * student filter has no control of its own: it is set by a link (`?student=`), so the list says
 * so and offers to clear it.
 */
export function InvoiceFilters({
  searchInput,
  onSearchInputChange,
  values,
  onChange,
}: InvoiceFiltersProps) {
  const t = useTranslations("fees");
  const portalT = useTranslations("portal.fees");
  const references = useInvoiceReferences();

  return (
    <>
      <SearchInput
        value={searchInput}
        onChange={onSearchInputChange}
        ariaLabel={t("invoices.filters.search")}
        placeholder={t("invoices.list.searchPlaceholder")}
        clearLabel={t("invoices.filters.clearSearch")}
      />
      {references.canReadSessions && (
        <FilterSelect
          label={t("invoices.filters.session")}
          allLabel={t("invoices.filters.all")}
          value={values.session}
          onChange={(session) => {
            onChange({ session });
          }}
          options={references.sessions}
        />
      )}
      {references.canReadStructures && (
        <FilterSelect
          label={t("invoices.filters.structure")}
          allLabel={t("invoices.filters.all")}
          value={values.structure}
          onChange={(structure) => {
            onChange({ structure });
          }}
          options={references.structures}
        />
      )}
      <FilterSelect
        label={t("invoices.filters.status")}
        allLabel={t("invoices.filters.all")}
        value={toPick(values.status)}
        onChange={(pick) => {
          onChange({ status: toFilter(pick) });
        }}
        options={FEE_INVOICE_STATUSES.map((status) => ({
          id: status,
          name: enumLabel(portalT, FEE_STATUS_LABEL_KEY, status),
        }))}
      />
      <div className="flex items-center gap-2">
        <Switch
          id="invoice-defaulters"
          checked={values.outstanding === OUTSTANDING_ON}
          onCheckedChange={(checked) => {
            onChange({ outstanding: checked ? OUTSTANDING_ON : OUTSTANDING_OFF });
          }}
        />
        <Label htmlFor="invoice-defaulters">{t("invoices.filters.defaulters")}</Label>
      </div>
      {values.student !== "" && (
        <button
          type="button"
          className="text-sm text-primary hover:underline"
          onClick={() => {
            onChange({ student: "" });
          }}
        >
          {t("invoices.filters.clearStudent")}
        </button>
      )}
    </>
  );
}
