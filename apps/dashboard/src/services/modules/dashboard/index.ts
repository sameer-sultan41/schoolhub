import {
  fetchAcademicSessions,
  fetchClasses,
  fetchCountTotal,
  fetchMyTimetable,
  fetchPendingPromotions,
  fetchPendingSubstitutions,
  fetchPeriods,
  fetchSections,
  fetchTeacherLoadSummary,
  listCountable,
} from "./dashboard-service";

export const DashboardService = {
  listCountable,
  fetchCountTotal,
  fetchAcademicSessions,
  fetchTeacherLoadSummary,
  fetchSections,
  fetchClasses,
  fetchPendingSubstitutions,
  fetchPendingPromotions,
  fetchMyTimetable,
  fetchPeriods,
};
