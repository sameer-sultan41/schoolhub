import {
  createSlot,
  deleteSlot,
  fetchSectionSlots,
  publishSection,
  updateSlot,
  validateSection,
} from "./timetable-slots-service";

export const TimetableSlotsService = {
  fetchSectionSlots,
  createSlot,
  updateSlot,
  deleteSlot,
  validateSection,
  publishSection,
};
export type {
  ConflictSeverity,
  SlotInput,
  SlotWriteResult,
  TimetableConflict,
  TimetablePublishResult,
  TimetableSlotRecord,
  TimetableValidation,
} from "./timetable-slots-type";
