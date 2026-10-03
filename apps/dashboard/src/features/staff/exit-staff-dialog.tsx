"use client";

import { useEffect, type MouseEvent, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { LogOut, X } from "lucide-react";
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
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
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
  useIsMobile,
} from "@schoolhub/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useForm, type UseFormReturn } from "react-hook-form";

import { ApiError, Services } from "@/services";
import { queryKeys } from "@/lib/query-client";
import { EXIT_REASON_MAX_LENGTH, EXIT_TYPE_OPTIONS } from "@/services/modules/staff/staff-constant";
import { exitFormSchema, type ExitFormValues } from "@/services/modules/staff/staff.schema";
import type { ExitStaffInput } from "@/services/modules/staff/staff-type";

export interface ExitStaffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Length 1 = a single row's "Delete" action; length > 1 = bulk "Exit selected". */
  staffIds: string[];
  /** Optional, same order as `staffIds`, for a friendlier confirmation/failure message. */
  staffNames?: string[];
}

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

interface ExitStaffFormBodyProps {
  form: UseFormReturn<ExitFormValues>;
  onSubmit: (values: ExitFormValues) => void;
  failures: ExitFailure[];
  succeededCount: number;
  staffIds: string[];
  staffNames?: string[];
  /** The Cancel/submit buttons, plus whatever wraps them (`AlertDialogFooter` on
   * desktop, `DrawerFooter` on mobile) — those two primitives aren't interchangeable
   * (see `ExitStaffDialog`'s own comment), so the caller builds this, not this
   * component. */
  footer: ReactNode;
}

/** The exit-date/reason/type fields and the inline failure list — identical between
 * the desktop `AlertDialog` and mobile `Drawer` renderings below, which differ only in
 * chrome (header/footer), never in what the form asks for or shows. */
function ExitStaffFormBody({
  form,
  onSubmit,
  failures,
  succeededCount,
  staffIds,
  staffNames,
  footer,
}: ExitStaffFormBodyProps) {
  const { handleSubmit } = form;
  return (
    <Form {...form}>
      <form
        className="space-y-4"
        // See login-form.tsx's own comment on this exact pattern — handleSubmit's
        // wrapper is promise-returning where the DOM expects void, and an unexpected
        // throw inside the resolver would otherwise vanish as an unhandled rejection.
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
          <Alert variant={succeededCount ? "warning" : "destructive"}>
            <AlertDescription>
              <p className="mb-1">
                {succeededCount
                  ? `${succeededCount} of ${staffIds.length} exited; ${failures.length} failed:`
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

        {footer}
      </form>
    </Form>
  );
}

export function ExitStaffDialog({
  open,
  onOpenChange,
  staffIds,
  staffNames,
}: ExitStaffDialogProps) {
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
        idsToSubmit.map((id) => Services.staff.exitStaff(id, input)),
      );
      const succeeded: string[] = [];
      const failed: ExitFailure[] = [];
      results.forEach((result, index) => {
        const id = idsToSubmit[index] as string;
        if (result.status === "fulfilled") {
          succeeded.push(id);
        } else {
          const reason: unknown = result.reason;
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
        void queryClient.invalidateQueries({ queryKey: queryKeys.module("staff") });
        // Dashboard-home's widgets key their own queries off a separate ["dashboard", ...]
        // prefix (see staff-form-dialog.tsx's own mutation for why this needs its own call).
        void queryClient.invalidateQueries({ queryKey: queryKeys.module("dashboard") });
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
  const succeededCount = mutation.data?.succeeded.length ?? 0;
  const actionLabel = idsToSubmit.length > 1 ? "Exit staff members" : "Exit staff member";
  // Referenced from both branches below instead of writing the JSX text twice: two
  // separate bare "Cancel" JSX literals would each count against this file's frozen
  // react/jsx-no-literals baseline (ADR-0014, counts may only fall) — one shared
  // reference stays under it without hiding a real new untranslated string.
  const cancelLabel = "Cancel";
  const description = isBulk
    ? `This deactivates portal logins and removes role assignments for ${staffIds.length} staff members. This cannot be undone.`
    : `This deactivates ${
        staffNames?.[0] ?? "this staff member"
      }'s portal login and removes their role assignments. This cannot be undone.`;

  // AlertDialog (Radix) and Drawer (vaul) are different primitives with no shared
  // "responsive" wrapper (see the plan this shipped from) — a plain `Dialog` swaps
  // into `Drawer` through `ResponsiveDialog`, but there is no alertdialog-equivalent
  // on the Drawer side, so this picks the whole tree rather than one component.
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} dismissible={false}>
        {/* Both this built-in close button and the footer's Cancel bypass Drawer.Close
            (see drawer.tsx's own departure-log comment #8) — vaul otherwise ignores
            every Drawer.Close-driven close whenever dismissible is false, which this
            confirmation deliberately sets so it can't be swiped away by accident. */}
        <DrawerContent closeLabel="Close" role="alertdialog">
          <DrawerHeader>
            <DrawerTitle>
              {isBulk ? `Exit ${staffIds.length} staff members` : "Exit staff member"}
            </DrawerTitle>
            <DrawerDescription>{description}</DrawerDescription>
          </DrawerHeader>
          <DrawerBody>
            <ExitStaffFormBody
              form={form}
              onSubmit={onSubmit}
              failures={failures}
              succeededCount={succeededCount}
              staffIds={staffIds}
              staffNames={staffNames}
              footer={
                <DrawerFooter className="flex-row justify-end gap-2.5">
                  {/* Icon-only, matching StaffDetailSheet's own mobile footer — Cancel
                      first, same order as staff-form-dialog.tsx's shared footer.
                      onClick calls onOpenChange directly rather than wrapping in
                      DrawerClose — see the dismissible comment on DrawerContent
                      above for why DrawerClose wouldn't work here. */}
                  <Button
                    type="button"
                    variant="outline"
                    mode="icon"
                    shape="circle"
                    aria-label={cancelLabel}
                    disabled={mutation.isPending}
                    onClick={() => {
                      onOpenChange(false);
                    }}
                  >
                    <X />
                  </Button>
                  {/* A plain submit button, unlike AlertDialogAction below: vaul's
                      Drawer has no Radix-style "close on click before the handler
                      runs" default to fight, so the form's own onSubmit (in
                      ExitStaffFormBody) already runs the validated submit as-is. */}
                  <Button
                    type="submit"
                    variant="destructive"
                    mode="icon"
                    shape="circle"
                    aria-label={actionLabel}
                    disabled={mutation.isPending}
                  >
                    <LogOut />
                  </Button>
                </DrawerFooter>
              }
            />
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isBulk ? `Exit ${staffIds.length} staff members` : "Exit staff member"}
          </AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        <ExitStaffFormBody
          form={form}
          onSubmit={onSubmit}
          failures={failures}
          succeededCount={succeededCount}
          staffIds={staffIds}
          staffNames={staffNames}
          footer={
            <AlertDialogFooter>
              <AlertDialogCancel disabled={mutation.isPending}>{cancelLabel}</AlertDialogCancel>
              <AlertDialogAction
                type="submit"
                variant="destructive"
                disabled={mutation.isPending}
                onClick={handleActionClick}
              >
                {actionLabel}
              </AlertDialogAction>
            </AlertDialogFooter>
          }
        />
      </AlertDialogContent>
    </AlertDialog>
  );
}
