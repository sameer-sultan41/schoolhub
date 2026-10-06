import { useRef } from "react";

/**
 * Blocks a second submit dispatched before the first one's async work has settled.
 * `mutation.isPending` alone isn't enough — it only flips true once `mutate()` actually
 * runs, deep inside `handleSubmit`'s own (always async) validation chain, leaving a
 * window where two submits fired close together both pass that check (commit
 * `e5326cd`'s root cause). `guard` must wrap the full submit — including a form's own
 * async validation, not just the mutation — so the check-and-set happens synchronously
 * before any of that async work starts.
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
