import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { Services } from "@/services";
import { attendanceRecord } from "@/services/modules/student-attendance/__tests__/student-attendance-fixtures";
import { AYESHA_ID, portalDashboard } from "@/test-fixtures/portal";
import { renderWithProviders } from "@/test-utils";

import { PortalAttendance } from "../portal-attendance";

jest.mock("next/navigation", () => ({
  useParams: () => ({ studentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
}));

jest.mock("@/services", () => ({
  Services: {
    parentPortal: { fetchPortalDashboard: jest.fn() },
    studentAttendance: { fetchAttendancePage: jest.fn() },
  },
}));

const mockFetchDashboard = Services.parentPortal.fetchPortalDashboard as jest.MockedFunction<
  typeof Services.parentPortal.fetchPortalDashboard
>;
const mockFetchPage = Services.studentAttendance.fetchAttendancePage as jest.MockedFunction<
  typeof Services.studentAttendance.fetchAttendancePage
>;

describe("PortalAttendance", () => {
  beforeEach(() => {
    mockFetchDashboard.mockReset();
    mockFetchPage.mockReset();
    // The summary's `as_of` (2026-11-15) says which month is the current one.
    mockFetchDashboard.mockResolvedValue(portalDashboard({ as_of: "2026-11-15" }));
    mockFetchPage.mockResolvedValue({
      items: [
        attendanceRecord({ id: "r1", attendance_date: "2026-11-02", status: "present" }),
        attendanceRecord({ id: "r2", attendance_date: "2026-11-03", status: "absent" }),
        attendanceRecord({ id: "r3", attendance_date: "2026-11-04", status: "half_day" }),
      ],
    });
  });

  it("attendance grid renders statuses and shows the percentage only for the current month", async () => {
    renderWithProviders(<PortalAttendance />);

    const days = within(await screen.findByRole("table", { name: /Attendance for November 2026/ }));
    expect(days.getByText("Present")).toBeInTheDocument();
    expect(days.getByText("Absent")).toBeInTheDocument();
    expect(days.getByText("Half day")).toBeInTheDocument();
    expect(mockFetchPage).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: AYESHA_ID,
        dateFrom: "2026-11-01",
        dateTo: "2026-11-30",
      }),
    );
    // The summary card's own percentage, as the server sent it.
    expect(await screen.findByText("Attendance this month: 96%")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /previous month/i }));

    await waitFor(() => {
      expect(mockFetchPage).toHaveBeenCalledWith(
        expect.objectContaining({ dateFrom: "2026-10-01", dateTo: "2026-10-31" }),
      );
    });
    expect(screen.queryByText(/Attendance this month/)).not.toBeInTheDocument();
  });

  it("says so when the month has no attendance", async () => {
    mockFetchPage.mockResolvedValue({ items: [] });

    renderWithProviders(<PortalAttendance />);

    expect(await screen.findByText("No attendance this month")).toBeInTheDocument();
  });

  it("offers a retry when the attendance fails to load", async () => {
    mockFetchPage.mockRejectedValueOnce(new Error("boom"));

    renderWithProviders(<PortalAttendance />);

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("table", { name: /Attendance for/ })).toBeInTheDocument();
  });
});
