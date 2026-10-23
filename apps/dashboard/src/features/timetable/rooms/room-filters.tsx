"use client";

import { useTranslations } from "next-intl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@schoolhub/ui";

import { FilterSelect } from "@/components/filter-select";
import { SearchInput } from "@/components/search-input";
import { useCampuses } from "@/hooks/use-reference-data";
import { FILTER_ALL } from "@/lib/constants";
import { ROOM_STATUS, ROOM_TYPES } from "@/services/modules/rooms/rooms-constant";

export interface RoomFiltersProps {
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  campusId: string;
  onCampusIdChange: (campusId: string) => void;
  type: string;
  onTypeChange: (type: string) => void;
  status: string;
  onStatusChange: (status: string) => void;
}

/** The rooms list's search box and its campus, type and status filters. */
export function RoomFilters({
  searchInput,
  onSearchInputChange,
  campusId,
  onCampusIdChange,
  type,
  onTypeChange,
  status,
  onStatusChange,
}: RoomFiltersProps) {
  const t = useTranslations("timetable");
  const campusesQuery = useCampuses();

  return (
    <>
      <SearchInput
        value={searchInput}
        onChange={onSearchInputChange}
        ariaLabel={t("filters.search")}
        placeholder={t("rooms.list.searchPlaceholder")}
        clearLabel={t("filters.clearSearch")}
      />
      <FilterSelect
        label={t("fields.campus")}
        allLabel={t("filters.all")}
        value={campusId}
        onChange={onCampusIdChange}
        options={campusesQuery.data ?? []}
      />
      <Select value={type} onValueChange={onTypeChange}>
        <SelectTrigger className="w-full sm:w-40" aria-label={t("rooms.filters.type")}>
          <SelectValue placeholder={t("rooms.filters.type")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={FILTER_ALL}>{t("filters.all")}</SelectItem>
          {ROOM_TYPES.map((roomType) => (
            <SelectItem key={roomType} value={roomType}>
              {t(`rooms.types.${roomType}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={status} onValueChange={onStatusChange}>
        <SelectTrigger className="w-full sm:w-40" aria-label={t("rooms.filters.status")}>
          <SelectValue placeholder={t("rooms.filters.status")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ROOM_STATUS.all}>{t("filters.all")}</SelectItem>
          <SelectItem value={ROOM_STATUS.active}>{t("rooms.active")}</SelectItem>
          <SelectItem value={ROOM_STATUS.inactive}>{t("rooms.inactive")}</SelectItem>
        </SelectContent>
      </Select>
    </>
  );
}
