"use client";

import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Checkbox,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@schoolhub/ui";
import { Building2, Filter, Home, Search, X } from "lucide-react";
import { STUDENT_STATUS_VALUES } from "@schoolhub/types";
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import { STUDENT_FILTER_ALL as ALL } from "@/services/modules/students/students-constant";
import { statusVariant } from "./student-columns";

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
      <div className="relative w-full sm:w-auto">
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
          // `pe-8` clears the trailing clear button (`end-1.5` + `w-6`) — without it,
          // typed text long enough to approach the box's end edge renders underneath it.
          className="w-full ps-9 pe-8 sm:max-w-64"
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
      {/* Single-select via checkboxes, matching `/staff`'s own Status filter — one value
          at a time, with the active choice shown as a colored badge on the trigger
          itself. Checking a status unchecks whichever was checked before; checking the
          already-active one (or the explicit "All" row) clears back to unfiltered. */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant={statusFilter === ALL ? "outline" : "outline-primary"}
            // A distinct accessible name from the visible "Status" text — the Status
            // column's own sort button (`DataGridColumnHeader`) already claims the bare
            // name "Status", and two same-named buttons on one page is a real a11y bug,
            // not just a flaky test selector.
            aria-label={t("filters.statusAriaLabel")}
            className="w-full justify-start sm:w-auto sm:justify-center"
          >
            <Filter className="text-primary" aria-hidden="true" />
            {t("filters.status")}
            {statusFilter !== ALL && (
              <Badge size="sm" variant={statusVariant(statusFilter)}>
                {t(`status.${statusFilter}`)}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-44 p-3" align="start" label={t("filters.status")}>
          <div className="space-y-3">
            <div className="text-xs font-medium text-muted-foreground">{t("filters.status")}</div>
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <Checkbox
                  id="student-status-all"
                  checked={statusFilter === ALL}
                  onCheckedChange={(checked) => {
                    if (checked) onStatusFilterChange(ALL);
                  }}
                />
                <Label htmlFor="student-status-all" className="grow font-normal">
                  {t("filters.all")}
                </Label>
              </div>
              {STUDENT_STATUS_VALUES.map((status) => (
                <div key={status} className="flex items-center gap-2.5">
                  <Checkbox
                    id={`student-status-${status}`}
                    checked={statusFilter === status}
                    onCheckedChange={(checked) => {
                      onStatusFilterChange(checked ? status : ALL);
                    }}
                  />
                  <Label htmlFor={`student-status-${status}`} className="grow font-normal">
                    {t(`status.${status}`)}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <Select
        value={campusId || ALL}
        onValueChange={(value) => {
          onCampusIdChange(value === ALL ? "" : value);
        }}
      >
        <SelectTrigger className="w-full sm:w-40" aria-label={t("filters.campus")}>
          <span className="!flex items-center gap-1.5">
            <Building2 className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <SelectValue placeholder={t("filters.campus")} />
          </span>
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
        <SelectTrigger className="w-full sm:w-40" aria-label={t("filters.house")}>
          <span className="!flex items-center gap-1.5">
            <Home className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <SelectValue placeholder={t("filters.house")} />
          </span>
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
