"use client";

import { Input } from "@schoolhub/ui";

export interface DateRangeInputsProps {
  /** `YYYY-MM-DD`, or `""` for none. */
  from: string;
  to: string;
  /** Each input's accessible name: it has no visible `<label>`. */
  fromLabel: string;
  toLabel: string;
  /** Called with the one end that changed; a cleared date is `""`. */
  onChange: (updates: { from?: string; to?: string }) => void;
}

/** A list filter's inclusive date range: two date inputs, each bounded by the other. */
export function DateRangeInputs({ from, to, fromLabel, toLabel, onChange }: DateRangeInputsProps) {
  return (
    <>
      <Input
        type="date"
        className="w-full sm:w-40"
        aria-label={fromLabel}
        value={from}
        max={to || undefined}
        onChange={(event) => {
          onChange({ from: event.target.value });
        }}
      />
      <Input
        type="date"
        className="w-full sm:w-40"
        aria-label={toLabel}
        value={to}
        min={from || undefined}
        onChange={(event) => {
          onChange({ to: event.target.value });
        }}
      />
    </>
  );
}
