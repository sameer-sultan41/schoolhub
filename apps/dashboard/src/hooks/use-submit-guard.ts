import { useRef, type SyntheticEvent } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";

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

export type SubmitGuard = ReturnType<typeof useSubmitGuard>;

/**
 * Wires a react-hook-form `form` into `useSubmitGuard`'s `guard` plus `form.handleSubmit`
 * in the one shape every submit handler in the students-phase2 plan ended up hand-writing
 * near-verbatim (`GuardianFormBody.onSubmit`, `GuardianPickerBody`'s create-tab submit,
 * `AddEmergencyContactDialog`'s submit, `DocumentUploadDialog.handleFormSubmit`) — four
 * copies of the same ~20 lines, differing only in what `onValid` actually does. This is
 * that shape, extracted once.
 *
 * Returns a ready-to-use `<form onSubmit={...}>` handler: it calls `event.preventDefault()`,
 * then runs `form.handleSubmit` through `submitGuard.guard` so a second submit dispatched
 * before the first one's async work (including RHF's own async validation) settles is
 * blocked — see `useSubmitGuard`'s own doc comment for why that wrapping has to start
 * before any of that async work does.
 *
 * `onValid` does the actual submit work for a value-passing submission (typically
 * `mutation.mutate(values, { onSettled: resolve })` wrapped in `new Promise`, optionally
 * preceded by its own pre-submit steps — clearing a dialog-level error, an early return
 * when there's nothing to submit) and should resolve its own returned promise once that
 * work settles, success or failure, the way every existing caller's `mutate(..., {
 * onSettled })` already does (TanStack Query always calls `onSettled`, so that promise
 * was never meant to reject). If it rejects anyway, this hook still releases the guard
 * (logging it) rather than leaving a truly unexpected `onValid` rejection hung forever —
 * the same last-resort net `useSubmitGuard`'s own `run` catch is for.
 */
export function useGuardedSubmit<TFieldValues extends FieldValues>(
  form: UseFormReturn<TFieldValues>,
  submitGuard: SubmitGuard,
  onValid: (values: TFieldValues) => Promise<void>,
): (event: SyntheticEvent) => void {
  return function handleGuardedSubmit(event: SyntheticEvent) {
    event.preventDefault();
    void submitGuard.guard(
      () =>
        new Promise<void>((resolve) => {
          form
            .handleSubmit(
              (values) => {
                onValid(values).then(resolve, (error: unknown) => {
                  console.error(error);
                  resolve();
                });
              },
              () => {
                // RHF's own validation failure branch — nothing to submit, but the guard
                // still must release for the next attempt.
                resolve();
              },
            )(event)
            .catch((error: unknown) => {
              // Same last-resort net as useSubmitGuard's own `run` catch: a truly
              // unexpected rejection out of handleSubmit itself (not onValid, handled
              // above) still releases the guard instead of leaving it blocked forever.
              console.error(error);
              resolve();
            });
        }),
    );
  };
}
