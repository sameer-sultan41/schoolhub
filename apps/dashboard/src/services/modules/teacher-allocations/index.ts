import {
  allocateTeacher,
  deleteAllocation,
  endAllocation,
  fetchAllocationsPage,
  fetchLoadSummary,
  reinstateAllocation,
  updateAllocation,
} from "./teacher-allocations-service";

export const TeacherAllocationsService = {
  fetchAllocationsPage,
  allocateTeacher,
  updateAllocation,
  endAllocation,
  reinstateAllocation,
  deleteAllocation,
  fetchLoadSummary,
};
export type {
  AllocateTeacherInput,
  AllocationSaveResult,
  TeacherAllocationPageQuery,
  TeacherAllocationRecord,
  TeacherLoadRow,
  TeacherLoadWarning,
  UpdateAllocationInput,
} from "./teacher-allocations-type";
