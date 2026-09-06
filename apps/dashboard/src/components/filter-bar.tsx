"use client";

import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@schoolhub/ui";
import { useId, type ReactNode } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

/**
 * The sentinel every list screen already uses for "no filter on this field". Kept out of
 * the request params entirely rather than sent as an empty string, so `{}` and
 * `{status: ""}` are the same cache key.
 */
export const ALL_FILTER_VALUE = "__all__";

export interface FilterBarSearchConfig {
  /** Visible label, and the input's accessible name. Required — there is no default. */
  label: string;
  placeholder?: string;
  /**
   * The committed value, i.e. the one the caller has in its query key. FilterBar owns
   * the *draft* the user is typing; this is what the draft debounces down to.
   */
  value: string;
  /** Called with the debounced value, not on every keystroke. */
  onChange: (value: string) => void;
}

export interface FilterBarSelectConfig {
  /** Stable key for React, and nothing else — the accessible name comes from `label`. */
  id: string;
  /** Visible label, and the trigger's accessible name. Required — there is no default. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  /** Label for the "no filter" option — usually `t("filters.all")`. */
  allLabel: string;
  /** Sentinel written back when the "all" option is picked. */
  allValue?: string;
  /** Width utility for this field, e.g. `"w-48"`. Defaults to `w-40`. */
  className?: string;
}

export interface FilterBarProps {
  search?: FilterBarSearchConfig;
  selects?: FilterBarSelectConfig[];
  /** "Clear filters". Required for the same reason every other label here is. */
  clearLabel: string;
  /**
   * Reset every filter the caller owns. FilterBar clears its own search draft before
   * calling this, so the handler only has to reset the caller's state.
   */
  onClear: () => void;
  /**
   * Controls FilterBar does not own — substitutions' two date inputs are the case —
   * rendered into the same row, before the clear control. A caller passing these must
   * also pass `extrasActive` so the clear control appears when one of them is set, and
   * must reset them from `onClear`.
   */
  children?: ReactNode;
  extrasActive?: boolean;
}

/**
 * One filter row: a debounced search box, a set of selects, and a clear control that
 * appears only once something is actually filtered.
 *
 * Every list screen used to hand-roll this — including its own copy of the debounce,
 * which is why students and staff each had the identical `searchTimer` ref and the
 * academics/timetable screens had none at all. The debounce is `useDebouncedValue`, on
 * the one `SEARCH_DEBOUNCE_MS` in `lib/constants.ts`; it is a hook rather than part of
 * this component because the one other place that needs it — the guardian-link dialog —
 * is not a filter row, and bending it into one would have been the wrong fix.
 *
 * The clear control is deliberately absent rather than disabled when nothing is set: a
 * permanently-greyed button in the filter row reads as something broken, and there is
 * nothing to explain — an unfiltered list has nothing to clear.
 */
export function FilterBar({
  search,
  selects = [],
  clearLabel,
  onClear,
  children,
  extrasActive = false,
}: FilterBarProps) {
  const searchInputId = useId();

  // The draft stays bound to the input so typing never lags; only the settled value — the
  // one that lands in the caller's query key — is delayed.
  const {
    draft,
    settled,
    onDraftChange,
    set: setSearchValue,
  } = useDebouncedValue(search?.value ?? "", {
    onSettle: (value) => {
      search?.onChange(value);
    },
  });

  // A caller that resets its own search state — `onClear` does exactly that — must not be
  // left with a stale draft in the box.
  if (search && search.value !== settled) setSearchValue(search.value);

  function clearAll() {
    setSearchValue("");
    onClear();
  }

  const isFiltered =
    extrasActive ||
    draft !== "" ||
    selects.some((select) => select.value !== (select.allValue ?? ALL_FILTER_VALUE));

  return (
    <div className="flex flex-wrap items-end gap-3">
      {search ? (
        <div className="min-w-48 flex-1 space-y-1">
          <label htmlFor={searchInputId} className="text-xs font-medium text-muted-foreground">
            {search.label}
          </label>
          <Input
            id={searchInputId}
            value={draft}
            onChange={(event) => {
              onDraftChange(event.target.value);
            }}
            placeholder={search.placeholder}
          />
        </div>
      ) : null}

      {children}

      {selects.map((select) => (
        <div key={select.id} className={`${select.className ?? "w-40"} space-y-1`}>
          <span className="text-xs font-medium text-muted-foreground">{select.label}</span>
          <Select value={select.value} onValueChange={select.onChange}>
            <SelectTrigger aria-label={select.label}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={select.allValue ?? ALL_FILTER_VALUE}>{select.allLabel}</SelectItem>
              {select.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}

      {isFiltered ? (
        <Button variant="ghost" size="sm" onClick={clearAll}>
          {clearLabel}
        </Button>
      ) : null}
    </div>
  );
}
