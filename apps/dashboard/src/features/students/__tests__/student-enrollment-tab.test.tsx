import { screen } from "@testing-library/react";

import { Services } from "@/services";
import { renderWithProviders } from "@/test-utils";
import { StudentEnrollmentTab } from "../student-enrollment-tab";

jest.mock("@/services", () => ({
  Services: {
    dashboard: { fetchCampuses: jest.fn() },
    schoolOrganization: {
      fetchAcademicSessions: jest.fn(),
      fetchClasses: jest.fn(),
      fetchSections: jest.fn(),
    },
    students: { fetchStudentHistory: jest.fn() },
    studentTransfers: { fetchStudentTransfers: jest.fn() },
  },
}));

const mockFetchStudentHistory = Services.students.fetchStudentHistory as jest.MockedFunction<
  typeof Services.students.fetchStudentHistory
>;
const mockFetchStudentTransfers = Services.studentTransfers
  .fetchStudentTransfers as jest.MockedFunction<
  typeof Services.studentTransfers.fetchStudentTransfers
>;
const mockFetchCampuses = Services.dashboard.fetchCampuses as jest.MockedFunction<
  typeof Services.dashboard.fetchCampuses
>;

function allGranted() {
  return {
    canEnroll: true,
    canChangeSection: true,
    canOverrideCapacity: true,
    canRequestTransfer: true,
    canDecide: true,
    canComplete: true,
  };
}

function noneGranted() {
  return {
    canEnroll: false,
    canChangeSection: false,
    canOverrideCapacity: false,
    canRequestTransfer: false,
    canDecide: false,
    canComplete: false,
  };
}

describe("StudentEnrollmentTab", () => {
  beforeEach(() => {
    mockFetchStudentHistory.mockReset();
    mockFetchStudentTransfers.mockReset();
    mockFetchCampuses.mockReset();
    mockFetchCampuses.mockResolvedValue([{ id: "campus-1", name: "Campus One" }]);
    mockFetchStudentTransfers.mockResolvedValue([]);
  });

  it("derives current enrollment as the active-status event with the latest date on ties", async () => {
    mockFetchStudentHistory.mockResolvedValue([
      {
        type: "enrollment",
        id: "e1",
        date: "2026-01-01",
        status: "active",
        academic_session_id: "s1",
        academic_session_name: "2025-26",
        class_id: "c1",
        class_name: "Grade 1",
        section_id: "sec1",
        section_name: "A",
        roll_number: null,
      },
      {
        type: "enrollment",
        id: "e2",
        date: "2026-04-01",
        status: "active",
        academic_session_id: "s2",
        academic_session_name: "2026-27",
        class_id: "c2",
        class_name: "Grade 2",
        section_id: "sec2",
        section_name: "B",
        roll_number: "7",
      },
    ] as never);

    renderWithProviders(
      <StudentEnrollmentTab studentId="s1" campusId="campus-1" permissions={allGranted()} />,
    );

    expect(await screen.findByText(/2026-27 — Grade 2 B/)).toBeInTheDocument();
    expect(screen.queryByText(/2025-26 — Grade 1 A/)).not.toBeInTheDocument();
  });

  it("shows a Not Enrolled state with an Enroll action when no enrollment event exists", async () => {
    mockFetchStudentHistory.mockResolvedValue([]);

    renderWithProviders(
      <StudentEnrollmentTab studentId="s1" campusId="campus-1" permissions={allGranted()} />,
    );

    expect(await screen.findByText(/not enrolled/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^enroll$/i })).toBeInTheDocument();
  });

  it("current enrollment and the history timeline share one query and fail together", async () => {
    mockFetchStudentHistory.mockRejectedValue(new Error("boom"));

    renderWithProviders(
      <StudentEnrollmentTab studentId="s1" campusId="campus-1" permissions={allGranted()} />,
    );

    expect(await screen.findByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("the transfers list fails and retries independently of history", async () => {
    mockFetchStudentHistory.mockResolvedValue([]);
    mockFetchStudentTransfers.mockRejectedValue(new Error("boom"));

    renderWithProviders(
      <StudentEnrollmentTab studentId="s1" campusId="campus-1" permissions={allGranted()} />,
    );

    expect(await screen.findByText(/not enrolled/i)).toBeInTheDocument();
    expect(await screen.findByText(/couldn't load this student's transfers/i)).toBeInTheDocument();
  });

  it("never renders a Complete trigger for an incoming-type transfer", async () => {
    mockFetchStudentHistory.mockResolvedValue([]);
    mockFetchStudentTransfers.mockResolvedValue([
      {
        id: "t1",
        student_id: "s1",
        transfer_type: "incoming",
        from_campus_id: null,
        to_campus_id: "campus-1",
        external_school_name: null,
        reason: "x",
        status: "approved",
        effective_date: "2026-01-01",
        decided_by: "u1",
        decided_at: "2026-01-02T00:00:00Z",
        certificate_document_id: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      },
    ] as never);

    renderWithProviders(
      <StudentEnrollmentTab studentId="s1" campusId="campus-1" permissions={allGranted()} />,
    );

    await screen.findByText(/incoming/i);
    expect(screen.queryByRole("button", { name: /complete/i })).not.toBeInTheDocument();
  });

  it("hides every action whose permission is not granted", async () => {
    mockFetchStudentHistory.mockResolvedValue([]);

    renderWithProviders(
      <StudentEnrollmentTab studentId="s1" campusId="campus-1" permissions={noneGranted()} />,
    );

    await screen.findByText(/not enrolled/i);
    expect(screen.queryByRole("button", { name: /^enroll$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /request transfer/i })).not.toBeInTheDocument();
  });
});
