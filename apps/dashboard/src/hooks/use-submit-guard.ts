import { useRef } from "react";

/**
 * Blocks a second submit dispatched before the first one's async work has settled.
 * `mutation.isPending` alone isn't enough — it only flips true once `mutate()` actually
 * runs, deep inside `handleSubmit`'s own (always async) validation chain, leaving a
 * window where two submits fired close together both pass that check (commit
 * `e5326cd`'s root cause). `guard` must wrap the full submit — including a form's own
 * async validation, not just the mutation — so the check-and-set happens synchronously
 * before any of that async work starts.
 *
 * Callers are responsible for surfacing their own `run` errors (a toast, a form field
 * error via `applyServerFieldErrors`, a dialog-level alert, etc.) — a rejection from
 * `run` is caught here only so the guard releases for the next submit; it is never
 * re-thrown and never shown to the user on its own. A `run` that lets an error reach
 * `guard` uncaught fails silently from the user's point of view (only a `console.error`),
 * so write `run` the way `GuardianFormBody.onSubmit` does: catch everything inside it and
 * resolve either way, with the mutation's own `onError` (or an equivalent) doing the
 * actual surfacing.
 */
export function useSubmitGuard() {
  const isSubmittingRef = useRef(false);

  async function guard(run: () => Promise<void>): Promise<void> {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    try {
      await run();
    } catch (error) {
      // Every real caller's own `run` already catches its own errors internally (see
      // GuardianFormBody.onSubmit, which only ever resolves) — this is a last-resort net
      // so a truly unexpected rejection still releases the guard for the next submit
      // instead of leaving it blocked forever.
      console.error("useSubmitGuard: the wrapped submit rejected unexpectedly", error);
    } finally {
      isSubmittingRef.current = false;
    }
  }

  return { guard };
}
