"use client";

import { useEffect, useRef, useState, type SyntheticEvent } from "react";
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
  // session — reused, never regenerated, when that same student is retried after a
  // partial bulk failure. A response lost in transit for a withdraw that actually
  // succeeded server-side must replay as the SAME request on retry, not a fresh one,
  // or the retry risks reporting a false failure for a student the server already
  // withdrew. Cleared on close (below) so a later, logically distinct withdrawal
  // attempt on the same student id never resends a stale key from a past session.
  const keysRef = useRef(new Map<string, string>());
  function keyFor(id: string): string {
    if (!keysRef.current.has(id)) keysRef.current.set(id, crypto.randomUUID());
    return keysRef.current.get(id) as string;
  }

  // Resets only on `!open` (close), never on a mere prop change while this component
  // stays mounted — correct here because the real caller (student-directory-table.tsx,
  // Task 8) conditionally RENDERS this dialog (`{withdrawDialog && <WithdrawStudentDialog
  // .../>}`) rather than keeping it mounted with `open` merely toggling: every open is a
  // fresh mount, so `idsToSubmit`/`result`/the cached idempotency keys never need to
  // survive past this close-time reset. (A caller that instead kept this component
  // permanently mounted and only toggled `open` would need this effect to also react to
  // `studentIds`/`studentNames` changing while still open — it does not, so that mounting
  // style is not safe with this component as written.) Mirrors student-form-dialog.tsx's
  // identical reset-on-close effect.
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIdsToSubmit(studentIds.map((id, index) => ({ id, name: studentNames[index] ?? "" })));
      setResult(null);
      keysRef.current.clear();
    }
  }, [open, studentIds, studentNames]);

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
          <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
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
