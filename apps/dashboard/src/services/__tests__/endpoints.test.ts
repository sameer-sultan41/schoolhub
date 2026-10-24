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
    expect(endpoints.dashboard.myTimetable).toBe("/timetables/my");
  });

  it("builds the id-scoped staff paths, staffExit as a colon-action not a nested path", () => {
    expect(endpoints.dashboard.staffDetail("staff-1")).toBe("/staff/staff-1");
    expect(endpoints.dashboard.staffExit("staff-1")).toBe("/staff/staff-1:exit");
  });

  it("builds the teacher-allocation paths, the load summary a fixed path beside the detail", () => {
    expect(endpoints.teacherAllocations.list).toBe("/teacher-subject-allocations");
    expect(endpoints.teacherAllocations.detail("allocation-1")).toBe(
      "/teacher-subject-allocations/allocation-1",
    );
    expect(endpoints.teacherAllocations.loadSummary).toBe(
      "/teacher-subject-allocations/load-summary",
    );
  });

  it("builds the bell-schedule and room paths", () => {
    expect(endpoints.periods.list).toBe("/periods");
    expect(endpoints.periods.detail("period-1")).toBe("/periods/period-1");
    expect(endpoints.rooms.list).toBe("/rooms");
    expect(endpoints.rooms.detail("room-1")).toBe("/rooms/room-1");
  });

  it("builds the grid paths, validate and publish as colon-actions on a section", () => {
    expect(endpoints.timetableSlots.list).toBe("/timetable-slots");
    expect(endpoints.timetableSlots.detail("slot-1")).toBe("/timetable-slots/slot-1");
    expect(endpoints.timetableSlots.validate("section-1")).toBe("/timetables/section-1:validate");
    expect(endpoints.timetableSlots.publish("section-1")).toBe("/timetables/section-1:publish");
  });

  it("declares the student bulk-operation paths, ID cards as a colon-action", () => {
    expect(endpoints.students.imports).toBe("/student-imports");
    expect(endpoints.students.exports).toBe("/student-exports");
    expect(endpoints.idCards.generate).toBe("/id-cards:generate");
  });

  it("builds the presigned-upload paths, confirm as a colon-action not a nested path", () => {
    expect(endpoints.files.create).toBe("/files");
    expect(endpoints.files.confirm("file-1")).toBe("/files/file-1:confirm");
  });
});
