import { ApiError } from "@schoolhub/api-client";

import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";

/**
 * The presigned upload flow shared by every module with a file field (a staff photo
 * today; qualification/document uploads later). Real three-step contract, confirmed by
 * reading `apps/api/core/files/services.py` (`create_upload`/`confirm_upload`),
 * `apps/api/core/files/views.py` and `apps/api/core/files/urls.py` directly rather than
 * assumed:
 *
 * 1. `POST /files` (`{original_name, mime_type, size_bytes, purpose}`) creates the
 *    pending `File` row and returns it merged with the presigned upload target —
 *    `FileViewSet.create` responds with
 *    `{...FileSerializer(file).data, upload_url, upload_method, headers, expires_at}`.
 *    `upload_method` is always `"PUT"` and `headers` is always `{"Content-Type":
 *    mime_type}` in both storage backends (`core/files/storage.py`'s `S3Presigner`/
 *    `NullPresigner`), but neither is hardcoded here — the server's own response drives
 *    the actual request.
 * 2. The browser sends the bytes straight to `upload_url` with a plain `fetch`, not
 *    `apiClient` — `apiClient` always joins whatever path it's given onto the API's own
 *    `baseUrl` (`joinUrl` in `@schoolhub/api-client`), and `upload_url` is already a
 *    fully-qualified, unauthenticated object-storage URL (S3/MinIO), typically on a
 *    different host entirely.
 * 3. `POST /files/{id}:confirm` — a colon-action, not a nested `/confirm` path (the real
 *    route registered in `core/files/urls.py`) — finalizes it. Only after this does the
 *    id become usable as a `photo_file_id` (or equivalent) on another record.
 */

/** The subset of `POST /files`'s response this flow actually reads. */
interface PresignedFileUpload {
  id: string;
  upload_url: string;
  upload_method: string;
  headers: Record<string, string>;
}

export type FileUploadStep = "create" | "put" | "confirm";

/**
 * Thrown for a failure at any one of the three steps, naming which step failed so a
 * caller never has to guess whether a `photo_file_id` it's about to send is actually
 * usable. `cause` carries the original error (an `ApiError` for `create`/`confirm`, a
 * plain `Error` for a failed `put`) for logging/inspection.
 */
export class FileUploadError extends Error {
  readonly step: FileUploadStep;
  readonly cause?: unknown;

  constructor(step: FileUploadStep, message: string, cause?: unknown) {
    super(message);
    this.name = "FileUploadError";
    this.step = step;
    this.cause = cause;
  }
}

/**
 * Uploads a browser `File` for `purpose` (a registered upload-purpose key — e.g.
 * `"staff.photo"`, `core/files/purposes.py`'s registry, `apps/staff_management/
 * uploads.py`'s `STAFF_PHOTO.key`) through all three real steps and resolves to the
 * finalized file's id, usable immediately as a `*_file_id` field on another record.
 *
 * Each step is caught and reported distinctly — a failed `put` must not silently
 * proceed to `:confirm` as though the bytes landed, and a failed `create`/`confirm`
 * must not be reported as anything other than what it is.
 */
export async function uploadFile(file: File, purpose: string): Promise<string> {
  let presigned: PresignedFileUpload;
  try {
    const { data } = await apiClient.post<PresignedFileUpload>(endpoints.files.create, {
      original_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      purpose,
    });
    presigned = data;
  } catch (cause) {
    // Preserve the backend's own specific validation message (e.g. "'image/gif' is not
    // allowed for 'staff.photo' uploads." or a file-size-limit message) when the caught
    // error is an `ApiError` with a real one, rather than always replacing it with the
    // generic fallback below.
    const detail = cause instanceof ApiError ? cause.message : null;
    throw new FileUploadError("create", detail ?? "Could not start the file upload.", cause);
  }

  try {
    const response = await fetch(presigned.upload_url, {
      method: presigned.upload_method,
      headers: presigned.headers,
      body: file,
    });
    if (!response.ok) {
      throw new Error(`Upload PUT responded with status ${response.status}.`);
    }
  } catch (cause) {
    throw new FileUploadError("put", "The file could not be uploaded to storage.", cause);
  }

  try {
    await apiClient.post(endpoints.files.confirm(presigned.id));
  } catch (cause) {
    throw new FileUploadError("confirm", "The upload could not be confirmed.", cause);
  }

  return presigned.id;
}
