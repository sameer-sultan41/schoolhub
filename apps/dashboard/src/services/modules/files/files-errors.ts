/**
 * The upload flow's failure, in a module of its own with no imports, so the `@/services` facade
 * and its test mock (`test-fixtures/services-mock.ts`) can both hand out the real class for an
 * `instanceof` check without loading the transport.
 */

export type FileUploadStep = "create" | "put" | "confirm";

/**
 * Thrown for a failure at any one of the three steps, naming which step failed so a
 * caller never has to guess whether a `photo_file_id` it's about to send is actually
 * usable. `cause` carries the original error (an `ApiError` for `create`/`confirm`, a
 * plain `Error` for a failed `put`) for logging/inspection.
 */
export class FileUploadError extends Error {
  readonly step: FileUploadStep;
  override readonly cause?: unknown;

  constructor(step: FileUploadStep, message: string, cause?: unknown) {
    super(message);
    this.name = "FileUploadError";
    this.step = step;
    this.cause = cause;
  }
}
