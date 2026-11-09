"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { FormControl, FormField, FormItem, FormLabel, FormMessage, Textarea } from "@schoolhub/ui";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";

const reasonSchema = (required: string, max: number) =>
  z.object({ reason: z.string().trim().min(1, required).max(max) });
type ReasonValues = z.infer<ReturnType<typeof reasonSchema>>;

export interface ReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  intro: string;
  reasonLabel: string;
  /** The longest reason the server takes; the box stops typing at it. */
  reasonMax: number;
  submitLabel: string;
  doneMessage: string;
  /** The query module the write stales (the tab's own list). */
  queryModule: string;
  /** The colon-action: Revoke discount, Waive fine, Void voucher. Resolves once the server accepted it. */
  action: (reason: string) => Promise<unknown>;
  /** The fields with an input (`reason`): a server error on any other, like a refused `status`, shows as the form's message. */
  knownFields: readonly string[];
}

/**
 * A confirm dialog that asks for the reason a lifecycle action needs (Revoke a discount, Waive a
 * fine, Void a voucher). The server's refusal (422) shows inline and the dialog stays open; the tab's list
 * reloads on success.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh form.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  intro,
  reasonLabel,
  reasonMax,
  submitLabel,
  doneMessage,
  queryModule,
  action,
  knownFields,
}: ReasonDialogProps) {
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(queryModule);

  const schema = useMemo(
    () => reasonSchema(tCommon("requiredField"), reasonMax),
    [tCommon, reasonMax],
  );
  const form = useForm<ReasonValues>({
    resolver: zodResolver(schema),
    defaultValues: { reason: "" },
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: ReasonValues) => action(values.reason.trim()),
    knownFields,
    onSuccess: () => {
      invalidate();
      toast.success(doneMessage);
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={intro}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
      submitLabel={submitLabel}
    >
      <FormField
        control={form.control}
        name="reason"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{reasonLabel}</FormLabel>
            <FormControl>
              <Textarea rows={3} maxLength={reasonMax} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormDialogLayout>
  );
}
