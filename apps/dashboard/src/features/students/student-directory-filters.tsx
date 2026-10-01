"use client";

import { useTranslations } from "next-intl";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@schoolhub/ui";
import { Search, X } from "lucide-react";
import { STUDENT_STATUS_VALUES } from "@schoolhub/types";
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";

/** Sentinel for "no filter" in each `Select` — the actual query omits the param
 * entirely rather than sending the literal string "all". */
const ALL = "all";

export interface StudentDirectoryFiltersProps {
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  campusId: string;
  onCampusIdChange: (value: string) => void;
  houseId: string;
  onHouseIdChange: (value: string) => void;
}

/**
 * The directory's search box plus its three `Select` filters. Built with
 * `@schoolhub/ui`'s `Select` primitive — the same one `StudentFormDialog` already uses
 * for Campus/House — rather than a hand-rolled listbox, so these stay genuinely
 * keyboard-operable (Radix wires arrow-key navigation, typeahead and `Escape` for free).
 * Each `SelectTrigger` carries its own `aria-label` since none of these three have a
 * visible `<label>` of their own the way a form field does.
 */
export function StudentDirectoryFilters({
  searchInput,
  onSearchInputChange,
  statusFilter,
  onStatusFilterChange,
  campusId,
  onCampusIdChange,
  houseId,
  onHouseIdChange,
}: StudentDirectoryFiltersProps) {
  const t = useTranslations("students");
  const campusesQuery = useQuery({
    queryKey: queryKeys.list("school-organization", "campuses"),
    queryFn: () => Services.dashboard.fetchCampuses(),
  });
  const housesQuery = useQuery({
    queryKey: queryKeys.list("school-organization", "houses"),
    queryFn: () => Services.schoolOrganization.fetchHouses(),
  });

  return (
    <>
      <div className="relative">
        <Search
          className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-primary"
          aria-hidden="true"
        />
        <Input
          aria-label={t("filters.search")}
          placeholder={t("list.searchPlaceholder")}
          value={searchInput}
          onChange={(e) => {
            onSearchInputChange(e.target.value);
          }}
          className="max-w-64 ps-9"
        />
        {searchInput.length > 0 && (
          <Button
            mode="icon"
            variant="ghost"
            aria-label={t("filters.clearSearch")}
            className="absolute end-1.5 top-1/2 h-6 w-6 -translate-y-1/2"
            onClick={() => {
              onSearchInputChange("");
            }}
          >
            <X aria-hidden="true" />
          </Button>
        )}
      </div>
      <Select value={statusFilter} onValueChange={onStatusFilterChange}>
        <SelectTrigger className="w-40" aria-label={t("filters.status")}>
          <SelectValue placeholder={t("filters.status")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
          {STUDENT_STATUS_VALUES.map((status) => (
            <SelectItem key={status} value={status}>
              {t(`status.${status}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={campusId || ALL}
        onValueChange={(value) => {
          onCampusIdChange(value === ALL ? "" : value);
        }}
      >
        <SelectTrigger className="w-40" aria-label={t("filters.campus")}>
          <SelectValue placeholder={t("filters.campus")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
          {(campusesQuery.data ?? []).map((campus) => (
            <SelectItem key={campus.id} value={campus.id}>
              {campus.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={houseId || ALL}
        onValueChange={(value) => {
          onHouseIdChange(value === ALL ? "" : value);
        }}
      >
        <SelectTrigger className="w-40" aria-label={t("filters.house")}>
          <SelectValue placeholder={t("filters.house")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
          {(housesQuery.data ?? []).map((house) => (
            <SelectItem key={house.id} value={house.id}>
              {house.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
