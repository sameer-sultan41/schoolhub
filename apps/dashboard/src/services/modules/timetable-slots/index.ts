import {
  createSlot,
  deleteSlot,
  fetchMyTimetable,
  fetchSectionSlots,
  fetchTeacherClassesOn,
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
  fetchMyTimetable,
  fetchTeacherClassesOn,
};
export type {
  ConflictSeverity,
  EffectiveSlotRecord,
  SlotInput,
  SlotWriteResult,
  TimetableConflict,
  TimetablePublishResult,
  TimetableSlotRecord,
  TimetableValidation,
} from "./timetable-slots-type";
