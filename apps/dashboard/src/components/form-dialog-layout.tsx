"use client";

import type { ReactNode, SyntheticEvent } from "react";
import { useTranslations } from "next-intl";
import type { FieldValues, UseFormReturn } from "react-hook-form";
import { Alert, Button, Form } from "@schoolhub/ui";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { useIsDesktopShell } from "@/hooks/use-is-desktop-shell";

export interface FormDialogLayoutProps<TValues extends FieldValues> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** An intro line above the fields. */
  description?: string;
  form: UseFormReturn<TValues>;
  onSubmit: (event: SyntheticEvent) => void;
  /** The server's refusal, shown above the fields. */
  formError: string | null;
  isPending: boolean;
  /** The submit button's screen-reader text while `isPending`. */
  submittingLabel: string;
  /** The submit button's text; defaults to "Save" (`common.save`). */
  submitLabel?: string;
  children: ReactNode;
}

/**
 * The dialog around a form: title, scrolling body (intro, then the server's error, above the
 * fields) and Cancel / submit, a bottom drawer on mobile. The caller owns the form, its submit
 * (`useFormDialogSubmit`) and the fields.
 */
export function FormDialogLayout<TValues extends FieldValues>({
  open,
  onOpenChange,
  title,
  description,
  form,
  onSubmit,
  formError,
  isPending,
  submittingLabel,
  submitLabel,
  children,
}: FormDialogLayoutProps<TValues>) {
  const tCommon = useTranslations("common");
  const isMobile = !useIsDesktopShell();

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-lg" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <Form {...form}>
          <form
            noValidate
            onSubmit={onSubmit}
            className={isMobile ? "flex min-h-0 grow flex-col" : undefined}
          >
            <ResponsiveDialogBody
              className={
                isMobile
                  ? "space-y-4 overflow-y-auto"
                  : "max-h-[65vh] space-y-4 overflow-y-auto pe-1"
              }
            >
              {description && <p className="text-sm text-muted-foreground">{description}</p>}
              {formError && <Alert variant="destructive">{formError}</Alert>}
              {children}
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
              <Button type="submit" isLoading={isPending} loadingLabel={submittingLabel}>
                {submitLabel ?? tCommon("save")}
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </Form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
