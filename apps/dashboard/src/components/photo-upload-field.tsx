"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useTranslations } from "next-intl";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from "@schoolhub/ui";
import { useWatch, type FieldValues, type Path, type UseFormReturn } from "react-hook-form";

import { getInitials, stableSignedUrl } from "@/lib/helpers";
import { Services } from "@/services";

/** The person-photo shape: a host form with it may leave out `fileIdField` and `fallbackName`
 * (both `StudentFormValues` and `GuardianFormValues` satisfy it, using the API's own
 * snake_case field names, Phase 1's convention). Any other form must pass both. */
export interface PhotoUploadFieldValues extends FieldValues {
  first_name: string;
  last_name: string;
  photo_file_id?: string;
}

export interface PhotoUploadFieldProps<TFieldValues extends FieldValues> {
  form: UseFormReturn<TFieldValues>;
  /** A plain string, not a closed union — `@/components/` is outside any one feature, so
   * this never hardcodes which `core/files` purposes exist. The caller passes whichever
   * `Services.files.uploadFile` purpose its own form needs (`"student.photo"`,
   * `"guardian.photo"`, or a future one neither of today's callers knows about yet). */
  uploadPurpose: string;
  /** The saved record's own photo id/url, plain strings rather than a whole record —
   * this component has no business knowing `StudentRecord` from `GuardianRecord`.
   * Both `undefined` in create mode. */
  savedPhotoFileId?: string | null;
  savedPhotoUrl?: string | null;
  /** Called as an upload starts. The check it returns reports whether the dialog is still in
   * the same open session, for the same record, as when that upload started. */
  onUploadStart: () => () => boolean;
  /** Lets the dialog disable Save while an upload is in flight. Must be referentially
   * stable (pass a `useState` setter): it is an effect dependency below, and a new
   * identity every render would re-run that effect's cleanup mid-upload. */
  onUploadingChange: (uploading: boolean) => void;
  /** The form field the uploaded file's id is stored in. Defaults to `photo_file_id`;
   * required for a form that isn't `PhotoUploadFieldValues` (`NamedFileFieldProps`). */
  fileIdField?: Path<TFieldValues>;
  /** The preview's fallback text, for a form with no `first_name`/`last_name` (a school's
   * logo); defaults to their initials, and is required where `fileIdField` is. */
  fallbackName?: string;
  /** The field's label; defaults to "Photo". */
  label?: string;
  /** The picker's `accept` list; defaults to JPEG and PNG. */
  accept?: string;
}

/** A form that isn't `PhotoUploadFieldValues` has neither default, so it must name its file
 * field and the preview's fallback. Tuple-wrapped so a union form isn't split. */
export type NamedFileFieldProps<TFieldValues extends FieldValues> = [TFieldValues] extends [
  PhotoUploadFieldValues,
]
  ? object
  : Required<Pick<PhotoUploadFieldProps<TFieldValues>, "fileIdField" | "fallbackName">>;

const DEFAULT_FILE_ID_FIELD = "photo_file_id";
const DEFAULT_ACCEPT = "image/jpeg,image/png";

/**
 * The shared photo picker: a preview (the freshly picked file, else the saved photo), the
 * three-step upload through `Services.files.uploadFile`, and its own uploading/error
 * state. Extracted from the student form's original `StudentPhotoField` (Phase 1) — the
 * third near-identical copy (students, staff, guardians) is this repo's own signal to
 * stop duplicating and share.
 *
 * The upload state lives here, not in the host dialog: a dialog that only mounts this
 * field while open starts it fresh on every open with no reset effect needed. Only "an
 * upload is in flight" is lifted, through `onUploadingChange`, because the dialog's Save
 * button needs it.
 */
export function PhotoUploadField<TFieldValues extends FieldValues>(
  props: PhotoUploadFieldProps<TFieldValues> & NamedFileFieldProps<TFieldValues>,
) {
  const {
    form,
    uploadPurpose,
    savedPhotoFileId,
    savedPhotoUrl,
    onUploadStart,
    onUploadingChange,
    fileIdField = DEFAULT_FILE_ID_FIELD as Path<TFieldValues>,
    fallbackName,
    label,
    accept = DEFAULT_ACCEPT,
  }: PhotoUploadFieldProps<TFieldValues> = props;
  const t = useTranslations("common.photoUpload");
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Cast to a 3-tuple of `Path<TFieldValues>`, not `Path<TFieldValues>[]`: an array type
  // loses arity, so `useWatch`'s tuple overload (via `FieldPathValues`'s homomorphic
  // mapped type) returns an array back, which a 3-element destructuring tuple can't
  // soundly narrow to. A tuple-typed `name` keeps the return a matching 3-tuple.
  const [firstName, lastName, photoFileId] = useWatch({
    control: form.control,
    name: ["first_name", "last_name", fileIdField] as [
      Path<TFieldValues>,
      Path<TFieldValues>,
      Path<TFieldValues>,
    ],
  }) as [string, string, string | undefined];

  // Only a still-mounted instance may report back to the dialog: an upload from a closed
  // session settling late must not re-enable Save while the next session's own upload is in
  // flight. Set inside the effect, not at init, so React's dev-mode remount restores it.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Unmounting mid-upload (the dialog closed) must not leave Save disabled.
      onUploadingChange(false);
    };
  }, [onUploadingChange]);

  // Revokes each object URL once a newer one (or none) replaces it, and the last on unmount.
  useEffect(() => {
    return () => {
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    };
  }, [localPreviewUrl]);

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Lets the same file be picked again after a failure — an unchanged value fires no event.
    event.target.value = "";
    if (!file) return;

    const isCurrentSession = onUploadStart();
    setLocalPreviewUrl(URL.createObjectURL(file));
    setUploadStatus("uploading");
    setUploadError(null);
    onUploadingChange(true);

    let outcome: { fileId: string } | { error: string };
    try {
      outcome = { fileId: await Services.files.uploadFile(file, uploadPurpose) };
    } catch (error) {
      // `uploadFile` rejects with a `FileUploadError` whose message is already specific: the
      // backend's own validation text (a disallowed type, a size limit), or the failed step.
      outcome = { error: error instanceof Error ? error.message : t("uploadFailed") };
    }

    if (!mountedRef.current) return;
    onUploadingChange(false);
    // One guard for both outcomes: a result from an earlier open session, or for a different
    // record, is dropped whether it succeeded or failed — never written into this form and
    // never shown as this session's error.
    if (!isCurrentSession()) {
      setUploadStatus("idle");
      setLocalPreviewUrl(null);
      return;
    }
    if ("fileId" in outcome) {
      form.setValue(fileIdField, outcome.fileId as never, {
        shouldDirty: true,
      });
      setUploadStatus("idle");
    } else {
      setUploadStatus("error");
      setUploadError(outcome.error);
      // The picked file never landed, so the preview goes back to what Save would keep.
      setLocalPreviewUrl(null);
    }
  }

  // The saved photo, until a replacement is picked: once `photo_file_id` no longer matches
  // the record's, the saved link is for the old photo.
  const resolvedSavedUrl =
    savedPhotoFileId !== undefined && photoFileId === (savedPhotoFileId ?? "")
      ? stableSignedUrl(savedPhotoUrl ?? null)
      : null;
  const previewUrl = localPreviewUrl ?? resolvedSavedUrl;

  return (
    <FormField
      control={form.control}
      name={fileIdField}
      render={() => (
        <FormItem>
          <FormLabel>{label ?? t("photo")}</FormLabel>
          <div className="flex items-center gap-3">
            <Avatar className="size-12 shrink-0">
              {previewUrl ? <AvatarImage src={previewUrl} alt="" /> : null}
              <AvatarFallback>
                {getInitials(fallbackName ?? `${firstName} ${lastName}`)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 space-y-1">
              <FormControl>
                <Input
                  type="file"
                  accept={accept}
                  disabled={uploadStatus === "uploading"}
                  onChange={(event) => {
                    void handlePhotoChange(event);
                  }}
                />
              </FormControl>
              {uploadStatus === "uploading" ? (
                <p className="text-xs text-muted-foreground">{t("uploading")}</p>
              ) : null}
              {uploadStatus === "error" && uploadError ? (
                <p className="text-xs text-destructive" role="alert">
                  {uploadError}
                </p>
              ) : null}
              {uploadStatus !== "uploading" && !previewUrl && photoFileId ? (
                <p className="text-xs text-muted-foreground">{t("onFile")}</p>
              ) : null}
            </div>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
