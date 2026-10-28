import {
  decideCorrection,
  fetchCorrectionPage,
  requestCorrection,
} from "./attendance-corrections-service";

export const AttendanceCorrectionsService = {
  requestCorrection,
  fetchCorrectionPage,
  decideCorrection,
};
export type {
  AttendanceCorrectionRecord,
  CorrectionAction,
  CorrectionChange,
  CorrectionNewValues,
  CorrectionPageQuery,
  CorrectionStatus,
  CorrectionSubjectType,
  RequestCorrectionInput,
} from "./attendance-corrections-type";
