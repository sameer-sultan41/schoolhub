"use client";

import { useEffect, type MouseEvent } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ApiError } from "@schoolhub/api-client";
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@schoolhub/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Services } from "@/services";
import type { ExitStaffInput } from "@/services/modules/dashboard/dashboard-service";

export interface ExitStaffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Length 1 = a single row's "Delete" action; length > 1 = bulk "Exit selected". */
  staffIds: string[];
  /** Optional, same order as `staffIds`, for a friendlier confirmation/failure message. */
  staffNames?: string[];
}

/**
 * Real enum values, `ExitRequestSerializer` (`apps/api/apps/staff_management/
 * serializers.py:253`). Left with no pre-selected default below — the server itself
 * defaults to `"resigned"` when the field is omitted from the request body entirely, so
 * this component must never spread a client-side `"resigned"` fallback into the payload.
 */
const EXIT_TYPE_OPTIONS = [
  { value: "resigned", label: "Resigned" },
  { value: "retired", label: "Retired" },
  { value: "terminated", label: "Terminated" },
];

const EXIT_REASON_MAX_LENGTH = 300;

const exitFormSchema = z.object({
  exit_date: z.string().min(1, "Exit date is required"),
  exit_reason: z
    .string()
    .min(1, "Exit reason is required")
    .max(EXIT_REASON_MAX_LENGTH, `Exit reason must be ${EXIT_REASON_MAX_LENGTH} characters or fewer`),
  // Genuinely optional — "" (the untouched default, and the Select's own placeholder
  // state) is mapped to "field omitted" below, exactly like `exitStaff` (Task 2) expects,
  // never sent through as a literal empty string.
  exit_type: z.string().optional(),
});

type ExitFormValues = z.infer<typeof exitFormSchema>;

const EMPTY_DEFAULTS: ExitFormValues = {
  exit_date: "",
  exit_reason: "",
  exit_type: "",
};

interface ExitFailure {
  id: string;
  message: string;
}

interface ExitOutcome {
  succeeded: string[];
  failed: ExitFailure[];
}

/** Looks a staff id up in the parallel `staffNames` array; falls back to the raw id when
 * `staffNames` wasn't supplied (or is shorter than `staffIds`) rather than blocking the
 * whole failure list on having a friendly name available for every id. */
function labelFor(id: string, staffIds: string[], staffNames?: string[]): string {
  const index = staffIds.indexOf(id);
  const name = index >= 0 ? staffNames?.[index] : undefined;
  return name ?? id;
}

export function ExitStaffDialog({ open, onOpenChange, staffIds, staffNames }: ExitStaffDialogProps) {
  const queryClient = useQueryClient();
  const isBulk = staffIds.length > 1;

  const form = useForm<ExitFormValues>({
    resolver: zodResolver(exitFormSchema),
    defaultValues: EMPTY_DEFAULTS,
  });
  const { handleSubmit } = form;

  const mutation = useMutation({
    mutationFn: async (values: ExitFormValues): Promise<ExitOutcome> => {
      const input: ExitStaffInput = {
        exitDate: values.exit_date,
        exitReason: values.exit_reason,
        ...(values.exit_type ? { exitType: values.exit_type as ExitStaffInput["exitType"] } : {}),
      };
      // Guard against an empty id list (not expected from a real caller — Task 5 only
      // ever passes a single row's id or a non-empty selection — but with nothing to call
      // `Promise.allSettled` would still resolve to `[]`, and `succeeded`/`failed` would
      // both come out empty; skip the network calls entirely rather than let that
      // ambiguous "nothing happened" shape reach `onSuccess` at all).
      if (idsToSubmit.length === 0) {
        return { succeeded: [], failed: [] };
      }

      // One `exitStaff` call per id, not a single bulk endpoint (the real backend has
      // none) — `allSettled` so one id's domain-rule rejection (already exited, an
      // exit_date before joining_date, a clearance blocker) never stops the rest of the
      // batch from going through.
      const results = await Promise.allSettled(
        idsToSubmit.map((id) => Services.dashboard.exitStaff(id, input)),
      );
      const succeeded: string[] = [];
      const failed: ExitFailure[] = [];
      results.forEach((result, index) => {
        const id = idsToSubmit[index] as string;
        if (result.status === "fulfilled") {
          succeeded.push(id);
        } else {
          const { reason } = result;
          failed.push({
            id,
            message: reason instanceof ApiError ? reason.message : "Unknown error",
          });
        }
      });
      return { succeeded, failed };
    },
    onSuccess: (result) => {
      // Two empty arrays only ever come from the `staffIds.length === 0` guard above —
      // never a real "batch of zero succeeded and zero failed" outcome — and must not be
      // read as "every id succeeded" (the `failed.length === 0` check below is otherwise
      // vacuously true for it too). Nothing was actually exited, so: no success toast, no
      // query invalidation, no close.
      if (result.succeeded.length === 0 && result.failed.length === 0) {
        return;
      }

      if (result.succeeded.length > 0) {
        // The successes are real and already committed server-side even when some ids in
        // the same batch failed, so the directory/toolbar queries are invalidated
        // regardless of whether every id made it through.
        void queryClient.invalidateQueries({ queryKey: ["staff"] });
      }

      if (result.failed.length === 0) {
        onOpenChange(false);
        toast.success(
          result.succeeded.length > 1
            ? `${result.succeeded.length} staff members exited`
            : "Staff member exited",
        );
        return;
      }

      // Full or partial failure: deliberately do NOT call onOpenChange(false) here. A
      // fully-failed batch obviously needs to stay open so the user sees why. A *partial*
      // failure could arguably auto-close since the successes are done, but leaving it
      // open too means the user sees exactly which id(s) still need attention instead of
      // having to go re-discover them from the directory table — the inline list below is
      // the whole point of not just firing a toast and moving on.
      if (result.succeeded.length === 0) {
        toast.error(
          result.failed.length > 1
            ? `${result.failed.length} staff members could not be exited`
            : "This staff member could not be exited",
        );
      } else {
        toast.warning(
          `${result.succeeded.length} of ${staffIds.length} exited; ${result.failed.length} failed`,
        );
      }
    },
  });

  // On the very first submission there is no prior outcome yet (`mutation.data` is
  // undefined), so this is the full `staffIds` list. On a RETRY after a partial failure,
  // narrow it to just the ids that haven't already succeeded — `staffIds` itself is a
  // fixed prop snapshot, and re-submitting the full list would re-run `exitStaff` for
  // already-succeeded ids too, which now 409 as "already exited" and make a retry look
  // like it made things worse. `mutationFn` above closes over this identifier; since it
  // only runs later (on submit), it always sees the value from the render that scheduled
  // it, never a stale one from before this declaration.
  const idsToSubmit = staffIds.filter((id) => !(mutation.data?.succeeded ?? []).includes(id));

  // Closing the dialog (Cancel, or a successful submit calling onOpenChange(false)) wipes
  // both the form and any prior outcome, so reopening it for a different id/selection
  // never shows a stale failure list or leftover field values from the last run.
  useEffect(() => {
    if (!open) {
      form.reset(EMPTY_DEFAULTS);
      mutation.reset();
    }
    // mutation is a fresh useMutation() result each render (TanStack Query's own object
    // identity is not stable) — depending on it would reset on every render while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form]);

  function onSubmit(values: ExitFormValues) {
    mutation.mutate(values);
  }

  // AlertDialogAction is Radix's `DialogPrimitive.Close` under the hood (confirmed by
  // reading the installed `@radix-ui/react-alert-dialog` source): clicking it always
  // calls this dialog's own `onOpenChange(false)` immediately, before react-hook-form's
  // validation or the mutation ever run. `event.preventDefault()` here is what stops that
  // default close (Radix's own composed click handler skips its close call once
  // `event.defaultPrevented` is true) — the dialog now only closes when *this* component
  // decides to, in `onSuccess` above. Since preventDefault also cancels the button's other
  // default action (submitting the form natively), the validated submit is triggered
  // manually right here via the same `handleSubmit` react-hook-form gives every other form
  // in this codebase — this is not "a raw onClick that skips validation", it runs the
  // identical validation path a native submit would have.
  function handleActionClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    handleSubmit(onSubmit)(event).catch((error: unknown) => {
      console.error("Unexpected error while submitting the staff exit form:", error);
    });
  }

  const failures = mutation.data?.failed ?? [];

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isBulk ? `Exit ${staffIds.length} staff members` : "Exit staff member"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isBulk
              ? `This deactivates portal logins and removes role assignments for ${staffIds.length} staff members. This cannot be undone.`
              : `This deactivates ${
                  staffNames?.[0] ?? "this staff member"
                }'s portal login and removes their role assignments. This cannot be undone.`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Form {...form}>
          <form
            className="space-y-4"
            // See login-form.tsx's own comment on this exact pattern — handleSubmit's
            // wrapper is promise-returning where the DOM expects void, and an unexpected
            // throw inside the resolver would otherwise vanish as an unhandled rejection.
            // In practice this rarely fires (AlertDialogAction's onClick above already
            // handles the real submit path), but it keeps this a genuine, independently
            // submittable form rather than one that only works via one specific button.
            onSubmit={(event) => {
              handleSubmit(onSubmit)(event).catch((error: unknown) => {
                console.error("Unexpected error while submitting the staff exit form:", error);
              });
            }}
            noValidate
          >
            <FormField
              control={form.control}
              name="exit_date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>Exit date</FormLabel>
                  <FormControl required>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="exit_reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>Exit reason</FormLabel>
                  <FormControl required>
                    <Textarea {...field} maxLength={EXIT_REASON_MAX_LENGTH} rows={3} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="exit_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Exit type</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Resigned (default)" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {EXIT_TYPE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {failures.length > 0 ? (
              <Alert variant={mutation.data?.succeeded.length ? "warning" : "destructive"}>
                <AlertDescription>
                  <p className="mb-1">
                    {mutation.data?.succeeded.length
                      ? `${mutation.data.succeeded.length} of ${staffIds.length} exited; ${failures.length} failed:`
                      : failures.length > 1
                        ? "None of the selected staff could be exited:"
                        : "This staff member could not be exited:"}
                  </p>
                  <ul className="list-disc space-y-0.5 ps-4">
                    {failures.map((failure) => (
                      <li key={failure.id}>
                        {labelFor(failure.id, staffIds, staffNames)} — {failure.message}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}

            <AlertDialogFooter>
              <AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                type="submit"
                variant="destructive"
                disabled={mutation.isPending}
                onClick={handleActionClick}
              >
                {/* Reflects `idsToSubmit`, not the original `staffIds` selection — on a
                    retry after a partial failure this narrows to however many ids are
                    actually left to submit, so a retry down to a single remaining id
                    correctly reads "Exit staff member", not the stale plural. */}
                {idsToSubmit.length > 1 ? "Exit staff members" : "Exit staff member"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
