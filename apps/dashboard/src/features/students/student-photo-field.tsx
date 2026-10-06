"use client";

import type { UseFormReturn } from "react-hook-form";
import type { StudentRecord } from "@/services";
import { PhotoUploadField } from "@/components/photo-upload-field";
import type { StudentFormValues } from "./student-form-schema";

export interface StudentPhotoFieldProps {
  form: UseFormReturn<StudentFormValues>;
  savedRecord?: StudentRecord;
  onUploadStart: () => () => boolean;
  onUploadingChange: (uploading: boolean) => void;
}

/** Thin wrapper around the shared `PhotoUploadField`, fixed to the student purpose and
 * `StudentRecord`'s own saved-photo fields. */
export function StudentPhotoField({
  form,
  savedRecord,
  onUploadStart,
  onUploadingChange,
}: StudentPhotoFieldProps) {
  return (
    <PhotoUploadField
      form={form}
      uploadPurpose="student.photo"
      savedPhotoFileId={savedRecord?.photo_file_id}
      savedPhotoUrl={savedRecord?.photo_url}
      onUploadStart={onUploadStart}
      onUploadingChange={onUploadingChange}
    />
  );
}
