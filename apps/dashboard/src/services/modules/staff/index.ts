import {
  createStaff,
  exitStaff,
  fetchStaffById,
  fetchStaffDirectory,
  fetchStaffPage,
  fetchStaffTypeCount,
  triggerStaffExport,
  triggerStaffImport,
  updateStaff,
} from "./staff-service";

export const StaffService = {
  fetchStaffDirectory,
  fetchStaffPage,
  fetchStaffTypeCount,
  createStaff,
  updateStaff,
  exitStaff,
  fetchStaffById,
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
