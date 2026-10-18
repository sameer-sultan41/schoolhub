"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@schoolhub/ui";

import { FILTER_ALL as ALL } from "@/lib/constants";

export interface FilterSelectProps {
  /** The trigger's accessible name and placeholder: it has no visible `<label>`. */
  label: string;
  /** The first option, standing for no filter. */
  allLabel: string;
  /** The picked id, or `""` for no filter. */
  value: string;
  /** Called with the picked id, or `""` for no filter. */
  onChange: (value: string) => void;
  options: readonly { id: string; name: string }[];
  disabled?: boolean;
}

/** A list filter `Select` over `{ id, name }` options, with an "All" choice for no filter. */
export function FilterSelect({
  label,
  allLabel,
  value,
  onChange,
  options,
  disabled,
}: FilterSelectProps) {
  return (
    <Select
      value={value || ALL}
      onValueChange={(selected) => {
        onChange(selected === ALL ? "" : selected);
      }}
      disabled={disabled}
    >
      <SelectTrigger className="w-full sm:w-40" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
