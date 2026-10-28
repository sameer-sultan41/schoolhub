"use client";

import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Textarea,
} from "@schoolhub/ui";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { keepServerMessage } from "@/features/attendance/keep-server-message";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { queryKeys } from "@/lib/query-client";
import { ApiError } from "@/services";

/** The dialog's strings, already translated for the action it decides. */
export interface DecisionDialogCopy {
  title: string;
  description: string;
  submit: string;
  submitting: string;
  note: string;
  noteHint: string;
  noteTooLong: string;
}

/** The form's values: just the note, under its API field name. */
type NoteValues = Record<string, string>;

export interface DecisionDialogProps<TResult> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  copy: DecisionDialogCopy;
  /** The module's note schema, keyed by `noteField`; module-level, so the memo holds. */
  createSchema: (messages: { noteTooLong: string }) => z.ZodType<NoteValues, NoteValues>;
  /** The note's API field name, so a server error on it lands under the input. */
  noteField: string;
  noteMaxLength: number;
  /** The fields a server error can land under; any other folds into the form's message. */
  knownFields: readonly string[];
  /** Sends the decision with the note, `""` for none. */
  decide: (note: string) => Promise<TResult>;
  /** The queue's query module, reloaded after a decision and on a 409. */
  queueModule: string;
  /** Further modules this decision rewrites (an approval's attendance records). */
  alsoRefresh?: readonly string[];
  /** The success toast, from what the decision returned. */
  successMessage: (result: TResult) => string;
}

/**
 * An approve / reject dialog with an optional note. A refusal shows inline and the dialog stays
 * open. A 409 (someone decided first) keeps the server's sentence, reloads the queue so the row
 * behind the dialog shows what happened, and holds the submit: the decision can no longer be made.
 *
 * Mounting contract: the caller mounts this only while it is open.
 */
export function DecisionDialog<TResult>({
  open,
  onOpenChange,
  copy,
  createSchema,
  noteField,
  noteMaxLength,
  knownFields,
  decide,
  queueModule,
  alsoRefresh = [],
  successMessage,
}: DecisionDialogProps<TResult>) {
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const [alreadyDecided, setAlreadyDecided] = useState(false);

  const schema = useMemo(
    () => createSchema({ noteTooLong: copy.noteTooLong }),
    [createSchema, copy.noteTooLong],
  );
  const form = useForm<NoteValues>({
    resolver: zodResolver(schema),
    defaultValues: { [noteField]: "" },
  });

  const refresh = (modules: readonly string[]) => {
    for (const queryModule of modules) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.module(queryModule) });
    }
  };

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: async (values: NoteValues) => {
      try {
        return await decide(values[noteField] ?? "");
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          setAlreadyDecided(true);
          refresh([queueModule]);
          throw keepServerMessage(error);
        }
        throw error;
      }
    },
    knownFields,
    onSuccess: (result) => {
      refresh([queueModule, ...alsoRefresh]);
      toast.success(successMessage(result));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={copy.title}
      description={copy.description}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={copy.submitting}
      submitLabel={copy.submit}
      submitDisabled={alreadyDecided}
    >
      <FormField
        control={form.control}
        name={noteField}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{copy.note}</FormLabel>
            <FormControl>
              <Textarea maxLength={noteMaxLength} {...field} />
            </FormControl>
            <FormDescription>{copy.noteHint}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormDialogLayout>
  );
}
