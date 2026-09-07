import { ChevronLeftIcon, ChevronRightIcon, MoreHorizontalIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";
import { getPageNumbers } from "../lib/page-numbers";
import { Button } from "./button";

/**
 * shadcn/ui Pagination (registry new-york-v4), ported per AGENTS.md §0c.
 *
 * Upstream ships seven unstyled slots (`Pagination`, `PaginationContent`,
 * `PaginationItem`, `PaginationLink`, `PaginationPrevious`, `PaginationNext`,
 * `PaginationEllipsis`) and leaves the caller to assemble them AND to compute the page
 * window by hand. Every caller in this repo wants the same assembly, so the composition
 * lives here and only `Pagination` is public — port what is used, not the whole registry
 * (the same call `toggle-group.tsx` made about upstream's standalone `Toggle`). The
 * upstream slot names survive as `data-slot` attributes so the DOM still reads like a
 * shadcn pagination.
 *
 * ── The two required adaptations ──────────────────────────────────────────────────
 *
 * 1. Direction is logical, never physical. Upstream renders a bare `ChevronLeftIcon` /
 *    `ChevronRightIcon` pair and pads them with `sm:pl-2.5` / `sm:pr-2.5`. Under Urdu
 *    (`dir="rtl"`) "previous" is to the RIGHT, so a straight port points both arrows the
 *    wrong way. Both chevrons carry `rtl:rotate-180` — the same mirroring
 *    `dropdown-menu.tsx` already uses on its submenu chevron — and the padding is `ps`/
 *    `pe`. Nothing else needs mirroring: the buttons sit in a `flex` row, which the
 *    browser already reverses under `dir="rtl"`, so DOM order stays
 *    previous → numbers → next in both directions.
 *
 * 2. Every user-facing string is a required prop. Upstream hardcodes English in four
 *    places — `aria-label="pagination"` on the nav, `"Previous"`, `"Next"`, and
 *    `"More pages"` — and this package has no i18n of its own, so any default here always
 *    ships untranslated. They become `label`, `previousLabel`, `nextLabel` and
 *    `morePagesLabel`; the numbered buttons need one string PER page, so that one is a
 *    function, `goToPageLabel(page)`. Same rule as `Dialog.closeLabel`,
 *    `Sheet.closeLabel`, `Button.loadingLabel` and `DataTable`'s `emptyState`.
 *
 * ── Three further departures, each load-bearing ───────────────────────────────────
 *
 * a. `<button>`, not upstream's `<a>`. Previous/Next are DISABLED at the ends rather
 *    than dropped from the DOM — a control that vanishes is harder to reacquire than one
 *    that greys out, and the row stops changing width as you reach either end. An anchor
 *    cannot be disabled at all (HTML has no such attribute for it), and this API is
 *    callback-driven (`onPageChange`) rather than href-driven, so a real button is both
 *    the honest element and the only one that can express the state.
 * b. The ellipsis's `sr-only` text is a SIBLING of the glyph, not a child of it.
 *    Upstream nests `<span className="sr-only">More pages</span>` inside a span that is
 *    itself `aria-hidden`, which hides the only announcement it has — the label is dead
 *    text. Here `aria-hidden` covers the icon alone.
 * c. The active page is not distinguished by colour alone. `aria-current="page"` covers
 *    assistive tech, but a reader who cannot separate the fill from the ground still
 *    needs to find their place, so the current page also gains a border and a heavier
 *    weight (WCAG 1.4.1 Use of Colour).
 */

/** One entry in the rendered row: a page button, or a gap where pages were skipped. */
type PaginationSlot = { kind: "page"; page: number } | { kind: "gap"; edge: "start" | "end" };

export interface PaginationProps
  // `aria-label`/`children` are owned below; `onChange` is omitted so a mistyped
  // `onChange` cannot be silently accepted as a DOM handler where `onPageChange` was meant.
  extends Omit<ComponentProps<"nav">, "aria-label" | "children" | "onChange"> {
  /** The page being shown, 1-based. */
  page: number;
  /** Total number of pages. `0` or less renders nothing — there is nothing to page. */
  totalPages: number;
  /** Called with the 1-based page the reader asked for. */
  onPageChange: (page: number) => void;
  /** Accessible name for the `<nav>`. Required — see the file header. */
  label: string;
  /** Previous-page control. Required — see the file header. */
  previousLabel: string;
  /** Next-page control. Required — see the file header. */
  nextLabel: string;
  /**
   * Accessible name for one numbered button, e.g. `(page) => t("goToPage", { page })`.
   * A function rather than a string because there is one label per page number.
   */
  goToPageLabel: (page: number) => string;
  /** Announced where the window skips pages. Required — see the file header. */
  morePagesLabel: string;
}

/**
 * Numbered pagination over a known page count.
 *
 * Holds no state: the caller owns `page` and re-renders with a new one from
 * `onPageChange`, so the same control works for URL-, query- and component-held state.
 */
export function Pagination({
  page,
  totalPages,
  onPageChange,
  label,
  previousLabel,
  nextLabel,
  goToPageLabel,
  morePagesLabel,
  className,
  ...props
}: PaginationProps) {
  const pages = getPageNumbers(page, totalPages);
  // An empty window means totalPages <= 0 — no pages, so no control at all. Note this is
  // the ONLY hiding this component does; every other "unavailable" state is a disabled
  // control, per (a) in the file header.
  if (pages.length === 0) return null;

  const firstInWindow = pages[0] ?? 1;
  const lastInWindow = pages.at(-1) ?? totalPages;

  const slots: PaginationSlot[] = [
    ...(firstInWindow > 1 ? [{ kind: "gap", edge: "start" } as const] : []),
    ...pages.map((pageNumber) => ({ kind: "page", page: pageNumber }) as const),
    ...(lastInWindow < totalPages ? [{ kind: "gap", edge: "end" } as const] : []),
  ];

  return (
    <nav
      aria-label={label}
      data-slot="pagination"
      // Not `w-full`: shadcn's own root stretches so a standalone pager can centre under
      // a page of content, but this one sits in `DataTable`'s footer beside the row-range
      // summary — a full-width child in that wrapping flex row takes a line of its own
      // and pushes the pager onto a second row for no reason.
      className={cn("flex justify-center", className)}
      {...props}
    >
      <ul data-slot="pagination-content" className="flex flex-row items-center gap-1">
        <li data-slot="pagination-item">
          <Button
            variant="outline"
            size="sm"
            aria-label={previousLabel}
            disabled={page <= 1}
            onClick={() => {
              onPageChange(page - 1);
            }}
            className="gap-1 px-2.5 sm:ps-2.5"
          >
            <ChevronLeftIcon aria-hidden="true" className="size-3.5 rtl:rotate-180" />
            {/* Hidden below `sm` so five numbers plus two word-labels still fit a phone.
                aria-label above carries the same string either way, so the control is
                never nameless — it just stops taking horizontal room it hasn't got. */}
            <span className="hidden sm:inline">{previousLabel}</span>
          </Button>
        </li>

        {slots.map((slot) =>
          slot.kind === "gap" ? (
            <li key={`gap-${slot.edge}`} data-slot="pagination-item">
              <span
                data-slot="pagination-ellipsis"
                className="flex size-8 items-center justify-center text-muted-foreground"
              >
                <MoreHorizontalIcon aria-hidden="true" className="size-3.5" />
                <span className="sr-only">{morePagesLabel}</span>
              </span>
            </li>
          ) : (
            <li key={slot.page} data-slot="pagination-item">
              <Button
                variant={slot.page === page ? "outline" : "ghost"}
                size="sm"
                aria-label={goToPageLabel(slot.page)}
                aria-current={slot.page === page ? "page" : undefined}
                onClick={() => {
                  onPageChange(slot.page);
                }}
                className={cn(
                  "min-w-8 px-2 font-numeric tabular-nums",
                  // Fill AND weight here, plus the border the `outline` variant adds over
                  // `ghost` above — three signals, so the current page is still findable
                  // without colour perception. See (c) in the file header.
                  slot.page === page && "bg-muted font-bold",
                )}
              >
                {slot.page}
              </Button>
            </li>
          ),
        )}

        <li data-slot="pagination-item">
          <Button
            variant="outline"
            size="sm"
            aria-label={nextLabel}
            disabled={page >= totalPages}
            onClick={() => {
              onPageChange(page + 1);
            }}
            className="gap-1 px-2.5 sm:pe-2.5"
          >
            <span className="hidden sm:inline">{nextLabel}</span>
            <ChevronRightIcon aria-hidden="true" className="size-3.5 rtl:rotate-180" />
          </Button>
        </li>
      </ul>
    </nav>
  );
}
