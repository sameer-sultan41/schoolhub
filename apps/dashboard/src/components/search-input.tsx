"use client";

import { Button, Input } from "@schoolhub/ui";
import { Search, X } from "lucide-react";

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  /** The input's accessible name: it has no visible `<label>`. */
  ariaLabel: string;
  placeholder: string;
  /** The clear button's accessible name. */
  clearLabel: string;
}

/** A list's search box: a leading search icon and, once there is text, a trailing clear button. */
export function SearchInput({
  value,
  onChange,
  ariaLabel,
  placeholder,
  clearLabel,
}: SearchInputProps) {
  return (
    <div className="relative w-full sm:w-auto">
      <Search
        className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-primary"
        aria-hidden="true"
      />
      <Input
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        // `pe-8` clears the trailing clear button, so long text never runs underneath it.
        className="w-full ps-9 pe-8 sm:max-w-64"
      />
      {value.length > 0 && (
        <Button
          mode="icon"
          variant="ghost"
          aria-label={clearLabel}
          className="absolute end-1.5 top-1/2 h-6 w-6 -translate-y-1/2"
          onClick={() => {
            onChange("");
          }}
        >
          <X aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
