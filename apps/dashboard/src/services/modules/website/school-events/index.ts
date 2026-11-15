import {
  archiveSchoolEvent,
  createSchoolEvent,
  deleteSchoolEvent,
  fetchSchoolEvent,
  fetchSchoolEventPage,
  publishSchoolEvent,
  unpublishSchoolEvent,
  updateSchoolEvent,
} from "./school-events-service";

export const SchoolEventsService = {
  fetchSchoolEventPage,
  fetchSchoolEvent,
  createSchoolEvent,
  updateSchoolEvent,
  deleteSchoolEvent,
  publishSchoolEvent,
  unpublishSchoolEvent,
  archiveSchoolEvent,
};
export type {
  SchoolEventDetail,
  SchoolEventInput,
  SchoolEventQuery,
  SchoolEventRecord,
  SchoolEventUpdateInput,
} from "./school-events-type";
