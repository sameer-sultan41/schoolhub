import { ChevronLeftIcon, ChevronRightIcon, MoreHorizontalIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";
import { getPageNumbers } from "../lib/page-numbers";
import { Button } from "./button";

/**
 * Pagination, composed from Metronic's own bare primitives
 * (`metronic nextjs/components/ui/pagination.tsx`: `Pagination`, `PaginationContent`,
 * `PaginationItem`, `PaginationEllipsis`) rather than a hand-rolled shadcn port —
 * `PaginationContent`/`PaginationItem`/`PaginationEllipsis` below match Metronic's own
 * `data-slot` attributes and class strings. The composed `Pagination` widget itself
 * stays schoolhub's own: Metronic ships no page-window/prev-next composition at all,
 * only unstyled parts the caller assembles by hand.
 *
 * ── Where this deliberately does not match Metronic's own file ────────────────────
 *
 * 1. `PaginationEllipsis`'s `aria-hidden` covers the icon only, not the whole span.
 *    Metronic's own file puts `aria-hidden` on the outer `<span>`, which hides its own
 *    `sr-only` "More pages" text along with the icon — a real bug, not a style choice.
 *    Here the icon alone is `aria-hidden`, the label a sibling, so it still reaches
 *    assistive tech.
 * 2. Direction is logical, never physical. Metronic's file has no chevrons at all (that
 *    is on the caller), so there is nothing to diverge from — but under Urdu
 *    (`dir="rtl"`) "previous" is to the RIGHT, so both chevrons carry `rtl:rotate-180`
 *    (the same mirroring `dropdown-menu.tsx` uses on its submenu chevron) and padding
 *    is `ps`/`pe`.
 * 3. Every user-facing string is a required prop, not Metronic's hardcoded
 *    `aria-label="pagination"` / `"More pages"` — this package has no i18n of its own,
 *    so a default here would always ship untranslated. `label`, `previousLabel`,
 *    `nextLabel`, `morePagesLabel` (now `PaginationEllipsis`'s own required `label`
 *    prop), and `goToPageLabel(page)` (one string per page, hence a function). Same
 *    rule as `Dialog.closeLabel`, `Button.loadingLabel`.
 * 4. Not `w-full` on the root. Metronic's own stretches so a standalone pager can
 *    centre under a page of content; this one sits in `DataTable`'s footer beside a
 *    row-range summary in a wrapping flex row, where `w-full` would push it onto its
 *    own line.
 * 5. The ellipsis is sized `size-7`/icon `size-3.5` here, not Metronic's own default
 *    `h-9 w-9`/`h-4 w-4` — those defaults are sized for Metronic's own default-size
 *    buttons; the numbered buttons beside it here are `size="sm"` (`h-7`), so the
 *    bigger default would render oversized next to them.
 * 6. `<button>`, not an `<a>`, for Previous/Next (Metronic's file doesn't render them
 *    at all). They are DISABLED at the ends rather than dropped from the DOM — a
 *    control that vanishes is harder to reacquire than one that greys out — and this
 *    API is callback-driven (`onPageChange`), so a real button is the only element
 *    that can express the state.
 * 7. The active page is not distinguished by colour alone: `aria-current="page"`
 *    covers assistive tech, but a reader who cannot separate the fill from the ground
 *    still needs to find their place, so the current page also gains a border and a
 *    heavier weight (WCAG 1.4.1 Use of Colour).
 */

function PaginationContent({ className, ...props }: ComponentProps<"ul">) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn("flex flex-row items-center gap-1", className)}
      {...props}
    />
  );
}

function PaginationItem({ className, ...props }: ComponentProps<"li">) {
  return <li data-slot="pagination-item" className={className} {...props} />;
}

function PaginationEllipsis({
  className,
  label,
  ...props
}: ComponentProps<"span"> & {
  /** Announced where the window skips pages. Required — see the file header. */
  label: string;
}) {
  return (
    <span
      data-slot="pagination-ellipsis"
      className={cn("flex items-center justify-center", className)}
      {...props}
    >
      <MoreHorizontalIcon aria-hidden="true" className="size-3.5" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

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
  // control, per (6) in the file header.
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
      role="navigation"
      aria-label={label}
      data-slot="pagination"
      className={cn("flex justify-center", className)}
      {...props}
    >
      <PaginationContent>
        <PaginationItem>
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
        </PaginationItem>

        {slots.map((slot) =>
          slot.kind === "gap" ? (
            <PaginationItem key={`gap-${slot.edge}`}>
              <PaginationEllipsis label={morePagesLabel} className="size-7 text-muted-foreground" />
            </PaginationItem>
          ) : (
            <PaginationItem key={slot.page}>
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
                  // without colour perception. See (7) in the file header.
                  slot.page === page && "bg-muted font-bold",
                )}
              >
                {slot.page}
              </Button>
            </PaginationItem>
          ),
        )}

        <PaginationItem>
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
        </PaginationItem>
      </PaginationContent>
    </nav>
  );
}

export { PaginationContent, PaginationEllipsis, PaginationItem };
