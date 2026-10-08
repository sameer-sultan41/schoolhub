import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
const mockFetchAcademicSessions = Services.schoolOrganization
  .fetchAcademicSessions as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchAcademicSessions
>;
const mockFetchClasses = Services.schoolOrganization.fetchClasses as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchClasses
>;
const mockFetchSections = Services.schoolOrganization.fetchSections as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchSections
>;

function buildTransfer(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    student_id: "s1",
    transfer_type: "outgoing",
    from_campus_id: "campus-1",
    to_campus_id: null,
    external_school_name: "Other School",
    reason: "x",
    status: "requested",
    effective_date: "2026-01-01",
    decided_by: null,
    decided_at: null,
    certificate_document_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

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
    mockFetchAcademicSessions.mockReset();
    mockFetchClasses.mockReset();
    mockFetchSections.mockReset();
    mockFetchCampuses.mockResolvedValue([{ id: "campus-1", name: "Campus One" }]);
    mockFetchStudentTransfers.mockResolvedValue([]);
    mockFetchAcademicSessions.mockResolvedValue([]);
    mockFetchClasses.mockResolvedValue([]);
    mockFetchSections.mockResolvedValue([]);
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

  it("opens the enroll dialog from the Enroll action", async () => {
    mockFetchStudentHistory.mockResolvedValue([]);

    const { baseElement } = renderWithProviders(
      <StudentEnrollmentTab studentId="s1" campusId="campus-1" permissions={allGranted()} />,
    );

    await userEvent.click(await screen.findByRole("button", { name: /^enroll$/i }));

    expect(baseElement.querySelector('[data-slot="dialog-content"]')).toBeInTheDocument();
  });

  it("opens the change-section dialog from the Change Section action", async () => {
    mockFetchStudentHistory.mockResolvedValue([
      {
        type: "enrollment",
        id: "e1",
        date: "2026-01-01",
        status: "active",
        academic_session_id: "s1",
        academic_session_name: "2026-27",
        class_id: "c1",
        class_name: "Grade 1",
        section_id: "sec1",
        section_name: "A",
        roll_number: null,
      },
    ] as never);

    const { baseElement } = renderWithProviders(
      <StudentEnrollmentTab studentId="s1" campusId="campus-1" permissions={allGranted()} />,
    );

    await userEvent.click(await screen.findByRole("button", { name: /change section/i }));

    expect(baseElement.querySelector('[data-slot="dialog-content"]')).toBeInTheDocument();
  });

  it("opens the request-transfer dialog from the Request Transfer action", async () => {
    mockFetchStudentHistory.mockResolvedValue([
      {
        type: "enrollment",
        id: "e1",
        date: "2026-01-01",
        status: "active",
        academic_session_id: "s1",
        academic_session_name: "2026-27",
        class_id: "c1",
        class_name: "Grade 1",
        section_id: "sec1",
        section_name: "A",
        roll_number: null,
      },
    ] as never);

    const { baseElement } = renderWithProviders(
      <StudentEnrollmentTab studentId="s1" campusId="campus-1" permissions={allGranted()} />,
    );

    await userEvent.click(await screen.findByRole("button", { name: /request transfer/i }));

    expect(baseElement.querySelector('[data-slot="dialog-content"]')).toBeInTheDocument();
  });

  it("shows Approve/Reject for a requested transfer and opens the decision dialog", async () => {
    mockFetchStudentHistory.mockResolvedValue([]);
    mockFetchStudentTransfers.mockResolvedValue([
      buildTransfer({ status: "requested", transfer_type: "outgoing" }),
    ] as never);

    const { baseElement } = renderWithProviders(
      <StudentEnrollmentTab studentId="s1" campusId="campus-1" permissions={allGranted()} />,
    );

    // Covers the external_school_name display branch (no to_campus_id on this transfer).
    expect(await screen.findByText(/other school/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    expect(baseElement.querySelector('[data-slot="alert-dialog-content"]')).toBeInTheDocument();
  });

  it("hides Approve/Reject on a requested transfer without the decide permission", async () => {
    mockFetchStudentHistory.mockResolvedValue([]);
    mockFetchStudentTransfers.mockResolvedValue([buildTransfer({ status: "requested" })] as never);

    renderWithProviders(
      <StudentEnrollmentTab
        studentId="s1"
        campusId="campus-1"
        permissions={{ ...allGranted(), canDecide: false }}
      />,
    );

    await screen.findByText(/other school/i);
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
  });

  it("shows Complete for an approved, non-incoming transfer and opens the completion dialog", async () => {
    mockFetchStudentHistory.mockResolvedValue([]);
    mockFetchStudentTransfers.mockResolvedValue([
      buildTransfer({
        status: "approved",
        transfer_type: "inter_campus",
        to_campus_id: "campus-1",
        external_school_name: null,
      }),
    ] as never);

    const { baseElement } = renderWithProviders(
      <StudentEnrollmentTab studentId="s1" campusId="campus-1" permissions={allGranted()} />,
    );

    await userEvent.click(await screen.findByRole("button", { name: /^complete$/i }));

    expect(baseElement.querySelector('[data-slot="alert-dialog-content"]')).toBeInTheDocument();
  });
});
