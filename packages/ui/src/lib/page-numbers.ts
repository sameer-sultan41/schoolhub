/** How many numbered pages a truncated pagination control shows at once. */
export const PAGE_WINDOW_SIZE = 5;

/** Every integer from `from` to `to`, inclusive. */
function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

/**
 * The page numbers a numbered pagination control should render, 1-based.
 *
 * Three cases:
 *  - Nothing to paginate (`totalPages <= 0`) — no numbers at all, so the caller can
 *    decide to render nothing rather than an empty control.
 *  - `totalPages <= PAGE_WINDOW_SIZE` — every page fits, so show every page and never
 *    truncate. A 3-page list showing "1 2 3" is strictly better than "1 2 3 …" .
 *  - Otherwise a `PAGE_WINDOW_SIZE`-wide window centred on `currentPage`.
 *
 * ── The clamping ──────────────────────────────────────────────────────────────────
 *
 * A window "centred on `currentPage`" naively starts at `currentPage - 2`, which runs
 * off both ends: page 1 would start the window at -1, and the last page would end it two
 * past `totalPages`. Either produces page buttons that do not exist.
 *
 * So the START of the window is clamped twice, and the order matters:
 *  1. `Math.max(…, 1)` stops it beginning before page 1.
 *  2. `Math.min(…, totalPages - PAGE_WINDOW_SIZE + 1)` stops it beginning so late that
 *     the window's END would run past `totalPages`.
 *
 * Clamping the start rather than trimming the result is what keeps the window a constant
 * width at both extremes: near page 1 it slides to `[1..5]`, near the end it slides to
 * `[totalPages-4..totalPages]`, and the control never changes size as the reader pages
 * through — buttons stay under the pointer instead of shuffling sideways.
 *
 * The upper clamp is only reachable because the `totalPages <= PAGE_WINDOW_SIZE` case
 * returned already; below that, `totalPages - PAGE_WINDOW_SIZE + 1` would be < 1 and
 * would fight the lower clamp.
 *
 * A `currentPage` outside `1..totalPages` is clamped by the same two bounds rather than
 * rejected — an out-of-range page is a caller bug worth surviving, and both clamps
 * already produce the sensible answer (the first or the last window).
 */
export function getPageNumbers(currentPage: number, totalPages: number): number[] {
  if (totalPages <= 0) return [];
  if (totalPages <= PAGE_WINDOW_SIZE) return range(1, totalPages);

  const before = Math.floor(PAGE_WINDOW_SIZE / 2);
  const lastPossibleStart = totalPages - PAGE_WINDOW_SIZE + 1;
  const start = Math.min(Math.max(currentPage - before, 1), lastPossibleStart);

  return range(start, start + PAGE_WINDOW_SIZE - 1);
}
