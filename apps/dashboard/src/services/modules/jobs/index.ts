import { fetchFileDownloadUrl, fetchJob } from "./jobs-service";

export const JobsService = {
  fetchJob,
  fetchFileDownloadUrl,
};

export type {
  BackgroundJobRecord,
  ExportJobResult,
  ImportJobResult,
  ImportRowError,
  JobAccepted,
  JobStatus,
} from "./jobs-service";
