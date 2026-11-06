import {
  createStaff,
  exitStaff,
  fetchStaffById,
  fetchStaffDirectory,
  fetchStaffPage,
  fetchStaffTypeCount,
  fetchTeachingStaffOptions,
  inviteStaff,
  triggerStaffExport,
  triggerStaffImport,
  updateStaff,
} from "./staff-service";

export const StaffService = {
  fetchStaffDirectory,
  fetchStaffPage,
  fetchStaffTypeCount,
  fetchTeachingStaffOptions,
  createStaff,
  updateStaff,
  exitStaff,
  fetchStaffById,
  inviteStaff,
  triggerStaffExport,
  triggerStaffImport,
};
export type {
  CreateStaffInput,
  ExitStaffInput,
  StaffDetailRecord,
  StaffDirectoryQuery,
  StaffDirectoryRecord,
  UpdateStaffInput,
} from "./staff-service";
