import {
  cancelSitting,
  createSitting,
  deleteSitting,
  fetchConflicts,
  fetchSittings,
  publishSchedule,
  updateSitting,
} from "./exam-schedules-service";

export const ExamSchedulesService = {
  fetchSittings,
  createSitting,
  updateSitting,
  cancelSitting,
  deleteSitting,
  fetchConflicts,
  publishSchedule,
};
export type {
  ConflictSeverity,
  ExamConflict,
  ExamConflictType,
  SchedulePublishResult,
  SittingDay,
  SittingInput,
  SittingRecord,
  SittingStatus,
  SittingWriteResult,
} from "./exam-schedules-type";
