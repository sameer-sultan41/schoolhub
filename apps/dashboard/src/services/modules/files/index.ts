import { uploadFile } from "./files-service";

export const FilesService = {
  uploadFile,
};

export { FileUploadError } from "./files-errors";
export type { FileUploadStep } from "./files-errors";
