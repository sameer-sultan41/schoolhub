"use client";

/**
 * shadcn/ui Checkbox (registry new-york-v4), ported per AGENTS.md §0c.
 *
 * The two mandatory adaptations:
 *
 *  1. `label` is required. Upstream renders a bare `CheckboxPrimitive.Root` with no
 *     accessible name at all — a screen reader announces "checkbox, not checked" and
 *     nothing else. Both call sites in this repo (the students roster's select-all and
 *     per-row boxes) sit in a table cell with no visible `<Label>` to be associated
 *     with, so the name has to come from a prop; and this package has no i18n of its
 *     own, so a defaulted English string would always ship untranslated. Same reasoning
 *     already applied to `Dialog.closeLabel`, `Sheet.closeLabel`, `Button.loadingLabel`,
 *     `PopoverContent.label` and `DataTable`'s `emptyState`/pagination labels.
 *  2. No physical direction prop survives, because upstream's Checkbox has none to
 *     begin with — no `side`, no `align`. The check still has to be made on every port,
 *     so: every utility below is either direction-neutral or already logical (a uniform
 *     `rounded-sm`, no `ml-`/`mr-`/`left-`/`right-`/`pl-`/`pr-`), and the tick is a
 *     centred glyph rather than an edge-anchored one. This mirrors under `dir="rtl"`
 *     with nothing to change.
 *
 * Three smaller departures from the upstream source, all of them this repo's own token
 * rules rather than taste:
 *
 *  - Upstream's literal `rounded-[4px]` becomes `rounded-sm`, which resolves through
 *    theme.css's `--radius-sm` (`max(calc(var(--sh-radius) - 4px), 0px)`) — so a tenant
 *    rebranding `--sh-radius` re-rounds this control too, and no literal length is
 *    frozen in. Plain `rounded-[var(--sh-radius)]` would be 10px on a 16px box, i.e. a
 *    radio button; `--radius-sm` is the token-derived stand-in for upstream's 4px, and
 *    is already what `DropdownMenuItem` and `SelectItem` use.
 *  - Upstream's `border-input`, `aria-invalid:*-destructive` and `dark:bg-input/30`
 *    become `border-border`, `aria-[invalid=true]:border-danger` and a plain
 *    `bg-background`, matching `Input`. There is no `dark:` variant anywhere in this
 *    package — dark mode is a token swap inside theme.css, not a per-utility variant —
 *    and the opaque background is what keeps the box readable on a hovered
 *    (`hover:bg-muted`) DataTable row.
 *  - Upstream's `shadow-xs` is dropped rather than translated. This package's only
 *    shadow vocabulary is theme.css's `shadow-elevation-*`, and a hairline shadow on a
 *    16px control buys nothing worth inventing a fourth elevation step for.
 *
 * `checked="indeterminate"` renders `Minus` instead of `Check` — Radix mounts the
 * Indicator for both states and puts `data-state` on the Root, so the swap is CSS keyed
 * off the Root's `group` rather than a read of `props.checked`. That keeps it correct
 * for an uncontrolled checkbox too, where this component never sees the state. Both
 * icons default to `hidden` and each is revealed by its own state, so neither depends on
 * out-specifying the other.
 */

import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

export interface CheckboxProps extends ComponentProps<typeof CheckboxPrimitive.Root> {
  /** Accessible name for the control. Required — see the file header. */
  label: string;
}

export function Checkbox({ className, label, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      aria-label={label}
      className={cn(
        "group peer size-4 shrink-0 rounded-sm border border-border bg-background",
        "transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-[invalid=true]:border-danger",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        "data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current"
      >
        <Check className="hidden size-3.5 group-data-[state=checked]:block" />
        <Minus className="hidden size-3.5 group-data-[state=indeterminate]:block" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
