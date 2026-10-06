"use client";

import { useState, type ChangeEvent, type SyntheticEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
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
  Label,
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
import { useSubmitGuard } from "@/hooks/use-submit-guard";
import { applyServerFieldErrors } from "@/lib/error-message";
import { ApiError, Services } from "@/services";
import { DOCUMENT_TYPES } from "@/services/modules/students/students-constant";
import {
  documentFormSchema,
  type DocumentFormValues,
} from "@/services/modules/students/students.schema";

export interface DocumentUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  onUploaded: () => void;
}

export function DocumentUploadDialog({
  open,
  onOpenChange,
  studentId,
  onUploaded,
}: DocumentUploadDialogProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");

  const [file, setFile] = useState<File | null>(null);
  // Keeps a successful upload's id across a failed metadata-POST retry — `core/files`'
  // `File` rows can't be deleted, so retrying the whole mutation would otherwise
  // re-upload the same file and leave the first attempt as a permanent orphan row.
  const [uploadedFileId, setUploadedFileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<DocumentFormValues>({
    resolver: zodResolver(documentFormSchema),
    defaultValues: {
      document_type: DOCUMENT_TYPES[0],
      title: "",
      notes: "",
      expires_at: "",
    },
  });
  // The upload itself is real async work (not just a quick validation round-trip), so
  // guarding against a double-submit here matters even more than in a plain form.
  const submitGuard = useSubmitGuard();

  const mutation = useMutation({
    mutationFn: async (values: DocumentFormValues) => {
      const fileId =
        uploadedFileId ?? (await Services.files.uploadFile(file as File, "student.document"));
      setUploadedFileId(fileId);
      return Services.students.uploadDocumentRecord(studentId, {
        fileId,
        documentType: values.document_type,
        title: values.title,
        ...(values.notes ? { notes: values.notes } : {}),
        ...(values.expires_at ? { expiresAt: values.expires_at } : {}),
      });
    },
    onSuccess: () => {
      onOpenChange(false);
      onUploaded();
    },
    onError: (err) => {
      // `Services.files.uploadFile` rejects with a `FileUploadError` (a plain `Error`
      // subclass) whose message is already the real step-specific text — never an
      // `ApiError`; shown as-is, since there's no form field to blame for a failed PUT or
      // a rejected MIME type. `uploadDocumentRecord`'s own failure, by contrast, is a real
      // `ApiError` from the backend (e.g. a bad `document_type` or title), which needs
      // the same `applyServerFieldErrors` helper `GuardianFormDialog`/`AddEmergencyContactDialog`
      // use — a matched field lands inline on its own `FormMessage` instead of only ever
      // showing a generic "please correct the highlighted fields" with nothing actually
      // highlighted (round-6 review finding).
      if (err instanceof ApiError) {
        applyServerFieldErrors({
          error: err,
          form,
          knownFields: Object.keys(documentFormSchema.shape),
          tErrors,
          fallback: t("form.submitFailed"),
          setFormError: setError,
        });
        return;
      }
      setError(err instanceof Error ? err.message : t("form.submitFailed"));
    },
  });

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    // A freshly picked file replaces whatever was uploaded before — never post a new
    // pick's metadata against an older file's id.
    setUploadedFileId(null);
  }

  function onSubmit(values: DocumentFormValues): Promise<void> {
    if (!file && !uploadedFileId) return Promise.resolve();
    setError(null);
    return new Promise((resolve) => {
      mutation.mutate(values, { onSettled: resolve });
    });
  }

  function handleFormSubmit(event: SyntheticEvent) {
    event.preventDefault();
    void submitGuard.guard(
      () =>
        new Promise<void>((resolve) => {
          form
            .handleSubmit(
              (values) => {
                void onSubmit(values).then(resolve);
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
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} nested>
      <ResponsiveDialogContent className="max-w-md" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("documents.upload")}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <Form {...form}>
          <form noValidate onSubmit={handleFormSubmit}>
            <ResponsiveDialogBody className="space-y-3">
              <p className="text-sm text-muted-foreground">{t("documents.uploadDescription")}</p>
              {error && <Alert variant="destructive">{error}</Alert>}
              <div className="space-y-1.5">
                <Label htmlFor="document-file">{t("documents.fields.file")}</Label>
                <Input id="document-file" type="file" onChange={handleFileChange} />
              </div>
              <FormField
                control={form.control}
                name="document_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("documents.fields.documentType")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger aria-label={t("documents.fields.documentType")}>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {DOCUMENT_TYPES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {t(`documents.type.${value}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("documents.fields.title")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="expires_at"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("documents.fields.expiresAt")}</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("documents.fields.notes")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                  </FormItem>
                )}
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
                disabled={(!file && !uploadedFileId) || mutation.isPending}
                isLoading={mutation.isPending}
                loadingLabel={t("documents.uploading")}
              >
                {mutation.isPending ? t("documents.uploading") : t("documents.upload")}
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </Form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
