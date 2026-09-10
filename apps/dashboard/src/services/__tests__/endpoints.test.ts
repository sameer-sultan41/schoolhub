import { endpoints } from "../endpoints";

describe("endpoints", () => {
  it("declares the auth and dashboard paths the services layer reads", () => {
    expect(endpoints.auth.me).toBe("/auth/me");
    expect(endpoints.dashboard).toEqual({
      students: "/students",
      staff: "/staff",
      classes: "/classes",
      sections: "/sections",
      subjects: "/subjects",
      campuses: "/campuses",
      academicSessions: "/academic-sessions",
      teacherLoadSummary: "/teacher-subject-allocations/load-summary",
      myTimetable: "/timetables/my",
    });
  });
});
