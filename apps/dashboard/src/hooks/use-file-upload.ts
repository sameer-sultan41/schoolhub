"use client";

import { ApiError } from "@schoolhub/api-client";
import { useMutation } from "@tanstack/react-query";
import type { CreatedUpload, UploadedFile } from "@/features/students/family-types";
import { apiClient } from "@/lib/auth";

interface UploadArgs {
  file: File;
  /** e.g. "student.document", "student.photo" — see core.files FILE_UPLOAD_RULES. */
  purpose: string;
}

/**
 * Drives the two-step upload flow (api-architecture.md §2.8): `POST /files`
 * returns a presigned PUT URL, the bytes go straight to storage — never through
 * `apiClient`, since the bearer token must never reach S3/MinIO — then
 * `POST /files/{id}:confirm` verifies the upload landed and flips it to `ready`.
 */
export function useFileUpload() {
  return useMutation({
    mutationFn: async ({ file, purpose }: UploadArgs): Promise<UploadedFile> => {
      const created = await apiClient.post<CreatedUpload>("/files", {
        original_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        purpose,
      });

      const { id, upload_url, upload_method, headers } = created.data;
      const response = await fetch(upload_url, { method: upload_method, headers, body: file });
      if (!response.ok) {
        throw new ApiError({
          code: "network_error",
          message: "The file upload to storage failed.",
          status: response.status,
          url: upload_url,
        });
      }

      const confirmed = await apiClient.post<UploadedFile>(`/files/${id}:confirm`);
      return confirmed.data;
    },
  });
}
