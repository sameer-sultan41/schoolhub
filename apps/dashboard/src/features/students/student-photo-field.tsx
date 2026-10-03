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
import { useWatch, type UseFormReturn } from "react-hook-form"; // a direct dependency (apps/dashboard/package.json) — not re-exported by @schoolhub/ui

import { getInitials, stableSignedUrl } from "@/lib/helpers";
import { Services, type StudentRecord } from "@/services";
import type { StudentFormValues } from "./student-form-schema";

export interface StudentPhotoFieldProps {
  form: UseFormReturn<StudentFormValues>;
  /** The record being edited, for its saved photo; `undefined` in create mode. */
  savedRecord?: StudentRecord;
  /** Called as an upload starts. The check it returns reports whether the dialog is still in
   * the same open session, for the same student, as when that upload started. */
  onUploadStart: () => () => boolean;
  /** Lets the dialog disable Save while an upload is in flight. Must be referentially
   * stable (pass a `useState` setter): it is an effect dependency below, and a new
   * identity every render would re-run that effect's cleanup mid-upload. */
  onUploadingChange: (uploading: boolean) => void;
}

/**
 * The student form's photo picker: a preview (the freshly picked file, else the saved
 * photo), the three-step upload through `Services.files.uploadFile`, and its own
 * uploading/error state — mirrors `staff-form-dialog.tsx`'s photo handling, in its own file
 * so `student-form-dialog.tsx` stays under the 400-line `max-lines` ceiling.
 *
 * The upload state lives here, not in the dialog: the dialog's body unmounts on close and
 * while an edit's detail loads, so every open starts this component fresh with no reset
 * effect needed. Only "an upload is in flight" is lifted, through `onUploadingChange`,
 * because the dialog's Save button needs it — saving mid-upload would report success and
 * silently drop the photo.
 *
 * Wrapped in a `FormField` for `photo_file_id` so a server error the dialog maps onto that
 * field shows in this `FormMessage` rather than nowhere.
 */
export function StudentPhotoField({
  form,
  savedRecord,
  onUploadStart,
  onUploadingChange,
}: StudentPhotoFieldProps) {
  const t = useTranslations("students");
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [firstName, lastName, photoFileId] = useWatch({
    control: form.control,
    name: ["first_name", "last_name", "photo_file_id"],
  });

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
      outcome = { fileId: await Services.files.uploadFile(file, "student.photo") };
    } catch (error) {
      // `uploadFile` rejects with a `FileUploadError` whose message is already specific: the
      // backend's own validation text (a disallowed type, a size limit), or the failed step.
      outcome = { error: error instanceof Error ? error.message : t("form.photoUploadFailed") };
    }

    if (!mountedRef.current) return;
    onUploadingChange(false);
    // One guard for both outcomes: a result from an earlier open session, or for a different
    // student, is dropped whether it succeeded or failed — never written into this form and
    // never shown as this session's error.
    if (!isCurrentSession()) {
      setUploadStatus("idle");
      setLocalPreviewUrl(null);
      return;
    }
    if ("fileId" in outcome) {
      form.setValue("photo_file_id", outcome.fileId, { shouldDirty: true });
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
  const savedPhotoUrl =
    savedRecord && photoFileId === (savedRecord.photo_file_id ?? "")
      ? stableSignedUrl(savedRecord.photo_url)
      : null;
  const previewUrl = localPreviewUrl ?? savedPhotoUrl;

  return (
    <FormField
      control={form.control}
      name="photo_file_id"
      render={() => (
        <FormItem>
          <FormLabel>{t("fields.photo")}</FormLabel>
          <div className="flex items-center gap-3">
            <Avatar className="size-12 shrink-0">
              {previewUrl ? <AvatarImage src={previewUrl} alt="" /> : null}
              <AvatarFallback>{getInitials(`${firstName} ${lastName}`)}</AvatarFallback>
            </Avatar>
            <div className="flex-1 space-y-1">
              <FormControl>
                <Input
                  type="file"
                  accept="image/jpeg,image/png"
                  disabled={uploadStatus === "uploading"}
                  onChange={(event) => {
                    void handlePhotoChange(event);
                  }}
                />
              </FormControl>
              {uploadStatus === "uploading" ? (
                <p className="text-xs text-muted-foreground">{t("fields.photoUploading")}</p>
              ) : null}
              {uploadStatus === "error" && uploadError ? (
                <p className="text-xs text-destructive" role="alert">
                  {uploadError}
                </p>
              ) : null}
              {uploadStatus !== "uploading" && !previewUrl && photoFileId ? (
                <p className="text-xs text-muted-foreground">{t("fields.photoOnFile")}</p>
              ) : null}
            </div>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
