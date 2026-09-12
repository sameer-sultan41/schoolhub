import { endpoints } from "../endpoints";

describe("endpoints", () => {
  it("declares the auth and dashboard paths the services layer reads", () => {
    expect(endpoints.auth.me).toBe("/auth/me");
    // Plain-string entries only — staffDetail/staffExit are functions, checked in their
    // own test below, same reasoning `files.confirm` already uses: a whole-object
    // `toEqual` here would have to reach past the two id-scoped functions instead of
    // checking them for real.
    expect(endpoints.dashboard.students).toBe("/students");
    expect(endpoints.dashboard.staff).toBe("/staff");
    expect(endpoints.dashboard.classes).toBe("/classes");
    expect(endpoints.dashboard.sections).toBe("/sections");
    expect(endpoints.dashboard.subjects).toBe("/subjects");
    expect(endpoints.dashboard.campuses).toBe("/campuses");
    expect(endpoints.dashboard.departments).toBe("/departments");
    expect(endpoints.dashboard.designations).toBe("/designations");
    expect(endpoints.dashboard.academicSessions).toBe("/academic-sessions");
    expect(endpoints.dashboard.teacherLoadSummary).toBe(
      "/teacher-subject-allocations/load-summary",
    );
    expect(endpoints.dashboard.myTimetable).toBe("/timetables/my");
  });

  it("builds the id-scoped staff paths, staffExit as a colon-action not a nested path", () => {
    expect(endpoints.dashboard.staffDetail("staff-1")).toBe("/staff/staff-1");
    expect(endpoints.dashboard.staffExit("staff-1")).toBe("/staff/staff-1:exit");
  });

  it("builds the presigned-upload paths, confirm as a colon-action not a nested path", () => {
    expect(endpoints.files.create).toBe("/files");
    expect(endpoints.files.confirm("file-1")).toBe("/files/file-1:confirm");
  });
});
