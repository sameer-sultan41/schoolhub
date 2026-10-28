"use client";

import { useTranslations } from "next-intl";
import { Checkbox, Label } from "@schoolhub/ui";

import { FilterSelect } from "@/components/filter-select";
import { FILTER_ALL } from "@/lib/constants";
import {
  CORRECTION_STATUSES,
  CORRECTIONS_MINE,
} from "@/services/modules/attendance-corrections/attendance-corrections-constant";

/** The URL filter keys this component writes (`CORRECTIONS_URL_FILTERS`). */
export interface CorrectionsFilterValues {
  status: string;
  mine: string;
}

export interface CorrectionsFiltersProps {
  values: CorrectionsFilterValues;
  onChange: (updates: Partial<CorrectionsFilterValues>) => void;
}

const MINE_ID = "corrections-mine";

/** The queue's status filter and the Mine toggle (only the caller's own requests). */
export function CorrectionsFilters({ values, onChange }: CorrectionsFiltersProps) {
  const t = useTranslations("attendance");
  const statusOptions = CORRECTION_STATUSES.map((status) => ({
    id: status,
    name: t(`requestStatus.${status}`),
  }));

  return (
    <>
      <FilterSelect
        label={t("corrections.filters.status")}
        allLabel={t("corrections.filters.all")}
        value={values.status === FILTER_ALL ? "" : values.status}
        options={statusOptions}
        onChange={(status) => {
          onChange({ status: status || FILTER_ALL });
        }}
      />
      <div className="flex items-center gap-2">
        <Checkbox
          id={MINE_ID}
          checked={values.mine === CORRECTIONS_MINE}
          onCheckedChange={(checked) => {
            onChange({ mine: checked === true ? CORRECTIONS_MINE : "" });
          }}
        />
        <Label htmlFor={MINE_ID} className="font-normal">
          {t("corrections.filters.mine")}
        </Label>
      </div>
    </>
  );
}
