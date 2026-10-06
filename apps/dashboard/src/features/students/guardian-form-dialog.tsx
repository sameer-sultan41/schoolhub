"use client";

import { useRef, useState, type SyntheticEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import {
  Alert,
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from "@schoolhub/ui";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { useIsDesktopShell } from "@/hooks/use-is-desktop-shell";
import { useSubmitGuard } from "@/hooks/use-submit-guard";
import { applyServerFieldErrors } from "@/lib/error-message";
import { Services } from "@/services";
import type { GuardianRecord } from "@/services";
import { formValuesToUpdateGuardianInput } from "@/services/modules/guardians/guardians-helper";
import {
  guardianFormSchema,
  type GuardianFormValues,
} from "@/services/modules/guardians/guardians.schema";
import { PhotoUploadField } from "@/components/photo-upload-field";

function toFormValues(guardian: GuardianRecord): GuardianFormValues {
  return {
    first_name: guardian.first_name,
    last_name: guardian.last_name,
    phone: guardian.phone,
    alt_phone: guardian.alt_phone ?? "",
    email: guardian.email ?? "",
    photo_file_id: guardian.photo_file_id ?? "",
  };
}

export interface GuardianFormFieldsProps {
  form: UseFormReturn<GuardianFormValues>;
  /** The saved guardian's own photo id/url — omitted entirely (both `undefined`) when
   * there is no existing guardian yet, i.e. every call from the picker's create-tab. */
  savedPhotoFileId?: string | null;
  savedPhotoUrl?: string | null;
  onUploadStart: () => () => boolean;
  onUploadingChange: (uploading: boolean) => void;
}

/** The guardian person-fields themselves (first/last name, phone, alt phone, email,
 * photo) — exported so `GuardianPickerDialog`'s (Task 6) inline create-tab can render
 * the exact same fields without nesting a second `ResponsiveDialog` inside its own (not
 * supported on mobile — see this plan's Alternatives Considered). `GuardianFormBody`
 * below is this component plus the dialog chrome (title/footer/mutation) around it; the
 * picker's create-tab supplies its own chrome instead. Both live in `features/students/`,
 * so this is a same-feature import, not a cross-module one. */
export function GuardianFormFields({
  form,
  savedPhotoFileId,
  savedPhotoUrl,
  onUploadStart,
  onUploadingChange,
}: GuardianFormFieldsProps) {
  const t = useTranslations("students");
  return (
    <>
      <FormField
        control={form.control}
        name="first_name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("guardians.fields.firstName")}</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="last_name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("guardians.fields.lastName")}</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="phone"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("guardians.fields.phone")}</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="alt_phone"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("guardians.fields.altPhone")}</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="email"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("guardians.fields.email")}</FormLabel>
            <FormControl>
              <Input type="email" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <PhotoUploadField
        form={form}
        uploadPurpose="guardian.photo"
        savedPhotoFileId={savedPhotoFileId}
        savedPhotoUrl={savedPhotoUrl}
        onUploadStart={onUploadStart}
        onUploadingChange={onUploadingChange}
      />
    </>
  );
}

export interface GuardianFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** This dialog never fetches a guardian itself — the caller already has the record
   * (the tab's own guardian-details fan-out). Edit-only: nothing in this plan opens it
   * to create a guardian (the picker's create-tab renders `GuardianFormFields` directly,
   * Task 6), so there is no `mode` prop and no empty-defaults branch to keep in sync. */
  guardian: GuardianRecord;
  onSaved: (guardian: GuardianRecord) => void;
}

/** The shell: owns `ResponsiveDialog`'s open state and nothing else. `GuardianFormBody`
 * only mounts while `open` is true, keyed by the guardian's id — so switching from
 * editing one guardian to another always starts a fresh form instance with the right
 * defaults, with no reset effect. */
export function GuardianFormDialog({
  open,
  onOpenChange,
  guardian,
  onSaved,
}: GuardianFormDialogProps) {
  const tCommon = useTranslations("common");
  const t = useTranslations("students");
  const isMobile = !useIsDesktopShell();

  return (
    // nested: this dialog's one caller (Task 7's "Edit guardian" row action) always
    // opens it from inside StudentDetailSheet's own mobile drawer — hardcoded rather
    // than a prop, since nothing here ever opens standalone (Task 5, Part A).
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} nested>
      <ResponsiveDialogContent className="max-w-lg" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("guardians.editGuardianTitle")}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {open ? (
          <GuardianFormBody
            key={guardian.id}
            guardian={guardian}
            isMobile={isMobile}
            onOpenChange={onOpenChange}
            onSaved={onSaved}
          />
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

interface GuardianFormBodyProps {
  guardian: GuardianRecord;
  isMobile: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (guardian: GuardianRecord) => void;
}

function GuardianFormBody({ guardian, isMobile, onOpenChange, onSaved }: GuardianFormBodyProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");

  // Captured once per mount (this component remounts fresh on every open — see the
  // `key` at the call site), so every upload from this open session shares one id; a
  // result settling after this instance has already unmounted is simply dropped by
  // `PhotoUploadField`'s own `mountedRef` check, with nothing here to coordinate.
  const openSessionRef = useRef(Symbol("guardian-form-open"));
  const submitGuard = useSubmitGuard();
  const [formError, setFormError] = useState<string | null>(null);
  const [isPhotoUploading, setIsPhotoUploading] = useState(false);

  const form = useForm<GuardianFormValues>({
    resolver: zodResolver(guardianFormSchema),
    defaultValues: toFormValues(guardian),
  });

  const mutation = useMutation({
    mutationFn: (values: GuardianFormValues) => {
      // `formValuesToUpdateGuardianInput` (`guardians-helper.ts`) maps an empty
      // alt_phone/email to an explicit `null`, not a bare `""` — this form always
      // resubmits every field, so an empty value here means "clear it", and only an
      // explicit `null` reaches the request body through `toUpdateGuardianBody`'s
      // `!== undefined` gate as a real clear. Sending `""` would silently turn a stored
      // `null` back into `""` on every unrelated save (round-6 review finding).
      return Services.guardians.updateGuardian(
        guardian.id,
        formValuesToUpdateGuardianInput(values),
      );
    },
    onSuccess: (saved) => {
      onOpenChange(false);
      onSaved(saved);
    },
    onError: (error) => {
      applyServerFieldErrors({
        error,
        form,
        knownFields: Object.keys(guardianFormSchema.shape),
        tErrors,
        fallback: t("form.submitFailed"),
        setFormError,
      });
    },
  });

  function captureUploadSession() {
    const uploadSession = openSessionRef.current;
    return () => openSessionRef.current === uploadSession;
  }

  function onSubmit(event: SyntheticEvent) {
    event.preventDefault();
    void submitGuard.guard(
      () =>
        new Promise<void>((resolve) => {
          form
            .handleSubmit(
              (values) => {
                mutation.mutate(values, { onSettled: resolve });
              },
              () => {
                resolve();
              },
            )(event)
            .catch((error: unknown) => {
              console.error(error);
              resolve();
            });
        }),
    );
  }

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={onSubmit}
        className={isMobile ? "flex min-h-0 grow flex-col" : undefined}
      >
        <ResponsiveDialogBody
          className={
            isMobile ? "space-y-4 overflow-y-auto" : "max-h-[65vh] space-y-4 overflow-y-auto pe-1"
          }
        >
          {formError && <Alert variant="destructive">{formError}</Alert>}
          <GuardianFormFields
            form={form}
            savedPhotoFileId={guardian.photo_file_id}
            savedPhotoUrl={guardian.photo_url}
            onUploadStart={captureUploadSession}
            onUploadingChange={setIsPhotoUploading}
          />
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
            isLoading={mutation.isPending || isPhotoUploading}
            loadingLabel={t("guardians.submitting")}
          >
            {tCommon("save")}
          </Button>
        </ResponsiveDialogFooter>
      </form>
    </Form>
  );
}
