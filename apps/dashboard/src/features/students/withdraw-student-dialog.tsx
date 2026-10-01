"use client";

import { useRef, useState, type SyntheticEvent } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { z } from "zod";
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
  Textarea,
} from "@schoolhub/ui";

import { useIsDesktopShell } from "@/hooks/use-is-desktop-shell";
import { resolveErrorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";

export interface WithdrawStudentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Length 1 = a single row's Withdraw action; length > 1 = bulk withdraw. */
  studentIds: string[];
  /** Same order as `studentIds` — the confirmation title and the per-student failure
   * list both key off a student's name by position in this array. */
  studentNames: string[];
}

const withdrawFormSchema = z.object({
  reason: z.string().min(1),
  effective_date: z.string().min(1),
});
type WithdrawFormValues = z.infer<typeof withdrawFormSchema>;

interface WithdrawTarget {
  id: string;
  name: string;
}

interface PerStudentFailure extends WithdrawTarget {
  message: string;
}

/**
 * Mounting contract: the caller must mount this conditionally — a fresh instance per open
 * (`{withdrawDialog && <WithdrawStudentDialog open ... />}`), or a remount via a `key` tied
 * to the selection — never keep one instance mounted and toggle its `open` prop.
 *
 * Why: everything this dialog remembers about a withdrawal attempt — the targets still to
 * submit (`idsToSubmit`, seeded from props only on mount), the last partial-failure
 * `result`, and the cached per-student idempotency keys — is per-instance state with no
 * reset-on-reopen logic, and it needs none under this contract. A persistent, open-toggled
 * instance would reopen showing the previous attempt's stale failure list, submit the
 * previous selection instead of the new one, and resend a past attempt's idempotency key
 * on a logically distinct withdrawal (which the server would replay, not perform). Don't
 * switch a caller to the persistent style without first adding that reset here.
 *
 * Reference usage: `student-directory-table.tsx`, which renders it only while its own
 * `withdrawDialog` state is non-null and clears that state on close.
 */
export function WithdrawStudentDialog({
  open,
  onOpenChange,
  studentIds,
  studentNames,
}: WithdrawStudentDialogProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktopShell();

  const [idsToSubmit, setIdsToSubmit] = useState<WithdrawTarget[]>(
    studentIds.map((id, index) => ({ id, name: studentNames[index] ?? "" })),
  );
  const [result, setResult] = useState<{
    succeeded: number;
    failed: PerStudentFailure[];
  } | null>(null);

  // One idempotency key per student, generated once and cached for this dialog
  // instance — reused, never regenerated, when that same student is retried after a
  // partial bulk failure. A response lost in transit for a withdraw that actually
  // succeeded server-side must replay as the SAME request on retry, not a fresh one,
  // or the retry risks reporting a false failure for a student the server already
  // withdrew. Never carried into a later, logically distinct attempt: that is a new
  // open, so a new instance with an empty map (see the mounting contract above).
  const keysRef = useRef(new Map<string, string>());
  function keyFor(id: string): string {
    if (!keysRef.current.has(id)) keysRef.current.set(id, crypto.randomUUID());
    return keysRef.current.get(id) as string;
  }

  const form = useForm<WithdrawFormValues>({
    resolver: zodResolver(withdrawFormSchema),
    defaultValues: { reason: "", effective_date: "" },
  });

  const mutation = useMutation({
    mutationFn: async (values: WithdrawFormValues) => {
      const targets = idsToSubmit;
      // Each promise resolves to its own outcome carrying its own {id, name} — it never
      // rejects — so pairing a result back to its student never needs an array index
      // (`outcomes[i]`). `noUncheckedIndexedAccess` makes that a real compile error
      // here, not just a style nit: `targets` and `outcomes` are two separately-typed
      // arrays the compiler has no way to know stay in lockstep.
      const outcomes = await Promise.all(
        targets.map(async ({ id, name }) => {
          try {
            await Services.students.withdrawStudent(
              id,
              { reason: values.reason, effectiveDate: values.effective_date },
              keyFor(id),
            );
            return { id, name, ok: true as const };
          } catch (error) {
            return {
              id,
              name,
              ok: false as const,
              message: resolveErrorMessage(error, tErrors, t("withdraw.submitFailed"), "non_field"),
            };
          }
        }),
      );
      const failed: PerStudentFailure[] = outcomes.filter(
        (outcome): outcome is typeof outcome & { ok: false } => !outcome.ok,
      );
      return { succeeded: outcomes.length - failed.length, failed };
    },
    onSuccess: ({ succeeded, failed }) => {
      if (succeeded > 0) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.module("students") });
        // Dashboard-home's widgets key their own queries off a separate
        // ["dashboard", ...] prefix — see exit-staff-dialog.tsx's own mutation for the
        // same split.
        void queryClient.invalidateQueries({ queryKey: queryKeys.module("dashboard") });
      }
      setResult({ succeeded, failed });
      // Narrow to only the ids that still need attention — a retry re-submits just
      // these, reusing each one's cached idempotency key via `keyFor` above.
      setIdsToSubmit(failed.map((failure) => ({ id: failure.id, name: failure.name })));
      if (failed.length === 0) onOpenChange(false);
    },
  });

  function handleSubmit(event: SyntheticEvent) {
    // Guards against a double submit from pressing Enter in the Textarea/Input while
    // the mutation is already in flight — the Drawer's confirm button has no `disabled`
    // of its own (only `isLoading`), and an Enter keypress bypasses a disabled button
    // anyway since it submits the form directly, not through a click.
    if (mutation.isPending) return;
    form
      .handleSubmit((values) => {
        mutation.mutate(values);
      })(event)
      .catch((error: unknown) => {
        console.error("Unexpected error while submitting the student withdrawal form:", error);
      });
  }

  const title =
    idsToSubmit.length > 1
      ? t("withdraw.titleBulk", { count: idsToSubmit.length })
      : t("withdraw.title", { name: idsToSubmit[0]?.name ?? "" });
  const confirmLabel =
    idsToSubmit.length > 1
      ? t("withdraw.confirmBulk", { count: idsToSubmit.length })
      : t("withdraw.confirm");
  const submitLabel = result?.failed.length ? t("withdraw.retry") : confirmLabel;

  const body = (
    <Form {...form}>
      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        {result && result.failed.length > 0 && (
          // `Alert`/`AlertDescription`, not a plain `text-destructive-foreground`
          // paragraph — that token resolves to white text in light mode (theme.css)
          // and would be unreadable on this dialog's own background. `Alert`'s variant
          // handles contrast correctly, the same way exit-staff-dialog.tsx's identical
          // partial-failure list does.
          <Alert variant={result.succeeded > 0 ? "warning" : "destructive"}>
            <AlertDescription>
              <p className="mb-1">
                {t("withdraw.partialFailureTitle", {
                  succeeded: result.succeeded,
                  failed: result.failed.length,
                })}
              </p>
              <ul className="list-disc space-y-0.5 ps-4">
                {result.failed.map((failure) => (
                  <li key={failure.id}>
                    {failure.name} — {failure.message}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        <FormField
          control={form.control}
          name="reason"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("withdraw.fields.reason")}</FormLabel>
              <FormControl>
                <Textarea {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="effective_date"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("withdraw.fields.effectiveDate")}</FormLabel>
              <FormControl>
                <Input type="date" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  );

  if (!isDesktop) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} dismissible={false}>
        <DrawerContent role="alertdialog" closeLabel={tCommon("close")}>
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription>{t("withdraw.description")}</DrawerDescription>
          </DrawerHeader>
          {body}
          <DrawerFooter>
            <Button
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => {
                onOpenChange(false);
              }}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              variant="destructive"
              isLoading={mutation.isPending}
              loadingLabel={t("withdraw.submitting")}
              onClick={handleSubmit}
            >
              {submitLabel}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{t("withdraw.description")}</AlertDialogDescription>
        </AlertDialogHeader>
        {body}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>{tCommon("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={mutation.isPending}
            onClick={(event) => {
              event.preventDefault();
              handleSubmit(event);
            }}
          >
            {submitLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
