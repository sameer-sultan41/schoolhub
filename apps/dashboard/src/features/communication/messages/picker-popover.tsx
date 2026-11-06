"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from "@schoolhub/ui";

export interface PickerOption {
  id: string;
  label: string;
  /** A second line: an admission number, a role. */
  hint?: string | null;
}

export interface PickerPopoverProps {
  /** The trigger's text. */
  triggerLabel: string;
  /** Held by the caller, so its search query runs only while the popover is open. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The search box's accessible name. */
  searchLabel: string;
  search: string;
  onSearchChange: (search: string) => void;
  options: readonly PickerOption[];
  isLoading: boolean;
  /** The reason the search failed, or `null`. */
  error: string | null;
  onPick: (id: string) => void;
  /** Close after a pick (a single choice); stay open to add several. */
  closeOnPick: boolean;
  /** Shown above the trigger: what is already chosen. */
  children?: ReactNode;
}

/**
 * A search-as-you-type picker: a trigger opening a popover with a search box and the matches.
 * The caller owns the open state, the query (and its debounce) and what a pick does; this is
 * only the shell the recipient and student pickers share.
 */
export function PickerPopover({
  triggerLabel,
  open,
  onOpenChange,
  searchLabel,
  search,
  onSearchChange,
  options,
  isLoading,
  error,
  onPick,
  closeOnPick,
  children,
}: PickerPopoverProps) {
  const t = useTranslations("communication.messages.picker");

  return (
    <div className="flex flex-col gap-2">
      {children}
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="w-full justify-start">
            {triggerLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="flex w-80 flex-col gap-2 p-2" align="start" label={triggerLabel}>
          <Input
            aria-label={searchLabel}
            placeholder={t("search")}
            value={search}
            onChange={(event) => {
              onSearchChange(event.target.value);
            }}
          />
          {error && <p className="px-1 text-sm text-destructive">{error}</p>}
          {isLoading && <p className="px-1 text-sm text-muted-foreground">{t("loading")}</p>}
          {!isLoading && !error && options.length === 0 && (
            <p className="px-1 text-sm text-muted-foreground">{t("noResults")}</p>
          )}
          <ul className="flex max-h-60 flex-col overflow-y-auto">
            {options.map((option) => (
              <li key={option.id}>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto w-full flex-col items-start gap-0 px-2 py-1.5 text-start"
                  onClick={() => {
                    onPick(option.id);
                    if (closeOnPick) onOpenChange(false);
                  }}
                >
                  <span className="text-sm text-foreground">{option.label}</span>
                  {option.hint && (
                    <span className="text-xs font-normal text-muted-foreground">{option.hint}</span>
                  )}
                </Button>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}
