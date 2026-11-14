import {
  createFeeSchedule,
  deleteFeeSchedule,
  fetchFeeSchedule,
  listFeeSchedules,
  updateFeeSchedule,
} from "./fee-schedules-service";

export const FeeSchedulesService = {
  listFeeSchedules,
  fetchFeeSchedule,
  createFeeSchedule,
  updateFeeSchedule,
  deleteFeeSchedule,
};
export type {
  FeeFrequency,
  FeeScheduleInput,
  FeeScheduleRecord,
  FeeSchedulesQuery,
} from "./fee-schedules-type";
