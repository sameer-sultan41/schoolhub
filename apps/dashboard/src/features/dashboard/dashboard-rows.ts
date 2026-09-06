import { DASHBOARD_MAX_ROWS } from "@/features/dashboard/dashboard-constants";

export interface TopRows<Datum> {
  /** What the panel plots, in the order it was given. */
  visible: Datum[];
  /** How many rows the cap left out. Zero hides the footer. */
  remainder: number;
}

/**
 * Cut an already-ordered list down to what a home-screen panel can show, and say how
 * many rows that left out.
 *
 * Ordering stays with the caller. "Heaviest first" and "class level, never size" are
 * claims about the data, made for reasons the two charts document separately; a helper
 * that sorted for them would have to be told which, and would have bought nothing. The
 * cut is the whole of what they share.
 *
 * It takes the mapped data rather than a mapper, so a caller that needs the full mapped
 * list for something else already has it. `toTeacherLoadRows` is exactly that caller: its
 * over-norm callout is filtered from every row, never from this slice, because a teacher
 * can be over their own norm on a light load while eight colleagues sit above them. Handing
 * this function a mapper would have left the callout mapping a second time from a second
 * source, which is how it drifted onto the slice the first time.
 *
 * It lives beside `dashboard-constants.ts` rather than in it: that file promises numbers
 * and keys to the five panels that import it, and this is neither.
 */
export function takeTopRows<Datum>(ordered: readonly Datum[]): TopRows<Datum> {
  const visible = ordered.slice(0, DASHBOARD_MAX_ROWS);
  return { visible, remainder: ordered.length - visible.length };
}
