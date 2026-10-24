import { requestCorrection } from "./attendance-corrections-service";

export const AttendanceCorrectionsService = {
  requestCorrection,
};
export type {
  AttendanceCorrectionRecord,
  CorrectionNewValues,
  RequestCorrectionInput,
} from "./attendance-corrections-type";
