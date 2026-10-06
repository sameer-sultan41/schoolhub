"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { RELATIONSHIP_VALUES } from "@schoolhub/types";
import {
  Alert,
  Button,
  Checkbox,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@schoolhub/ui";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { applyServerFieldErrors } from "@/lib/error-message";
import { Services } from "@/services";
import type { GuardianLinkRecord, UpdateGuardianLinkInput } from "@/services";
import {
  linkFlagsSchema,
  type LinkFlagsFormValues,
} from "@/services/modules/guardians/guardians.schema";

// Only the boolean flags — never `keyof LinkFlagsFormValues` (which also contains
// `relationship`, a string-literal union). `FormField`'s `name` prop infers
// `field.value`'s type from the union of every key this array's type admits, not from
// each tuple's own literal, so a wider key union here leaks `relationship`'s string
// values into the `Checkbox`'s `checked` prop below (it expects `CheckedState`).
type GuardianFlagKey = Exclude<keyof LinkFlagsFormValues, "relationship">;

// `ReadonlyArray<readonly [K, string]>`, not `as const satisfies readonly [K, string][]`
// — the latter's `readonly [...][]` targets a readonly array of MUTABLE tuples (the
// `readonly` modifier binds to the outer array, not each tuple — a known TS gotcha),
// which an `as const` literal's inner readonly tuples can never satisfy. Same pattern
// as `GUARDIAN_BODY_FIELDS`/`GUARDIAN_LINK_BODY_FIELDS` above (Task 2).
const FLAG_FIELDS: ReadonlyArray<readonly [GuardianFlagKey, string]> = [
  ["is_fee_responsible", "feeResponsible"],
  ["can_pick_up", "canPickUp"],
  ["receives_communications", "receivesCommunications"],
];

function toFormValues(link: GuardianLinkRecord): LinkFlagsFormValues {
  // The generated StudentGuardian type marks these optional (`boolean | undefined`),
  // but `LinkFlagsFormValues`'s zod schema requires real booleans — default each with
  // its own real model default (apps/api/apps/student_management/models.py's
  // `StudentGuardian` field defaults), not a blanket `false`: only `is_fee_responsible`
  // defaults false; the other two default true. These are the exact values
  // `link_guardian`'s own service defaults already use (Global Constraints above).
  // `has_portal_access` is read nowhere here — this dialog never edits it (see
  // `linkFlagsSchema`'s own comment above).
  return {
    relationship: link.relationship,
    is_fee_responsible: link.is_fee_responsible ?? false,
    can_pick_up: link.can_pick_up ?? true,
    receives_communications: link.receives_communications ?? true,
  };
}

/** `LinkFlagsFormValues` (snake_case, the Zod form shape) -> `UpdateGuardianLinkInput`
 * (Task 2, camelCase) — same bridge as `formValuesToCreateGuardianInput` (Task 2).
 * `hasPortalAccess` is simply never set here, so `toUpdateGuardianLinkBody`'s own
 * `!== undefined` gate omits it from the request entirely — the stored value is left
 * exactly as `link_guardian` (or a future change) set it. */
function toUpdateGuardianLinkInput(values: LinkFlagsFormValues): UpdateGuardianLinkInput {
  return {
    relationship: values.relationship,
    isFeeResponsible: values.is_fee_responsible,
    canPickUp: values.can_pick_up,
    receivesCommunications: values.receives_communications,
  };
}

export interface GuardianLinkFlagsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  link: GuardianLinkRecord;
  onSaved: () => void;
}

/**
 * Relationship + the three non-primary flags. `isPrimary` is deliberately never read or
 * written here — see this plan's Global Constraints on why promotion is its own
 * one-click row action, not a checkbox in this dialog.
 *
 * No reset-on-open effect: the caller (`student-guardians-tab.tsx`) only ever renders
 * this component at all while there is a link being edited (`{editingLink && <...>}`),
 * so every open is already a fresh mount — `useForm`'s `defaultValues` below already
 * gets the right starting values with no effect needed.
 */
export function GuardianLinkFlagsDialog({
  open,
  onOpenChange,
  link,
  onSaved,
}: GuardianLinkFlagsDialogProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");

  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<LinkFlagsFormValues>({
    resolver: zodResolver(linkFlagsSchema),
    defaultValues: toFormValues(link),
  });

  const mutation = useMutation({
    mutationFn: (values: LinkFlagsFormValues) =>
      Services.guardians.updateGuardianLink(link.id, toUpdateGuardianLinkInput(values)),
    onSuccess: () => {
      onOpenChange(false);
      onSaved();
    },
    onError: (error) => {
      // Same shared field-error-mapping helper as `GuardianFormDialog` (Task 5): a
      // matched field gets its own `FormMessage`; anything else falls back to the
      // dialog-level alert.
      applyServerFieldErrors({
        error,
        form,
        knownFields: Object.keys(linkFlagsSchema.shape),
        tErrors,
        fallback: t("form.submitFailed"),
        setFormError,
      });
    },
  });

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} nested>
      <ResponsiveDialogContent className="max-w-md" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("guardians.editLinkTitle")}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <Form {...form}>
          <form
            noValidate
            onSubmit={(event) => {
              // Wrapped (not passed directly) so the attribute sees a void-returning
              // function, not `form.handleSubmit(...)`'s own `Promise<void>` return —
              // `@typescript-eslint/no-misused-promises` otherwise flags the JSX
              // attribute, same as every other form dialog in this module.
              void form.handleSubmit((values) => {
                mutation.mutate(values);
              })(event);
            }}
          >
            <ResponsiveDialogBody className="space-y-4">
              {formError && <Alert variant="destructive">{formError}</Alert>}
              <FormField
                control={form.control}
                name="relationship"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("guardians.fields.relationship")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger aria-label={t("guardians.fields.relationship")}>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {RELATIONSHIP_VALUES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {t(`guardians.relationship.${value}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {FLAG_FIELDS.map(([key, labelKey]) => (
                <FormField
                  key={key}
                  control={form.control}
                  name={key}
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center gap-2 space-y-0">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <FormLabel className="font-normal">
                        {t(`guardians.flags.${labelKey}`)}
                      </FormLabel>
                    </FormItem>
                  )}
                />
              ))}
            </ResponsiveDialogBody>
            <ResponsiveDialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                }}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="submit"
                isLoading={mutation.isPending}
                loadingLabel={t("guardians.submitting")}
              >
                {tCommon("save")}
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </Form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
