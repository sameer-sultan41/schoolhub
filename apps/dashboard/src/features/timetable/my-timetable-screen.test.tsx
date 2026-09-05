import { ApiError } from "@schoolhub/api-client";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MyTimetableScreen } from "@/features/timetable/my-timetable-screen";
import { apiClient } from "@/lib/auth";
import { renderWithProviders } from "@/test-utils";

jest.mock("@/lib/auth", () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("@/hooks/use-session", () => ({
  usePermission: jest.fn(() => true),
  useAnyPermission: jest.fn(() => true),
}));
jest.mock("next/navigation", () => ({ usePathname: () => "/timetable/my" }));

// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

const MATHS = {
  id: "slot1",
  day_of_week: 0,
  period_id: "p1",
  period_name: "Period 1",
  period_sequence: 1,
  start_time: "08:00",
  end_time: "08:40",
  section_id: "sec1",
  section_name: "Grade 7 A",
  subject_id: "sub1",
  subject_name: "Mathematics",
  staff_id: "staff1",
  staff_name: "Bilal Ahmed",
  room_id: "room1",
  room_name: "L-12",
  notes: null,
};

const COVERED_SCIENCE = {
  ...MATHS,
  id: "slot2",
  day_of_week: 1,
  period_id: "p2",
  period_name: "Period 2",
  period_sequence: 2,
  start_time: "08:45",
  end_time: "09:25",
  subject_id: "sub2",
  subject_name: "Science",
  substitute_staff_id: "staff9",
  substitute_staff_name: "Sana Iqbal",
};

function answer(slots: unknown[], date: string | null = null) {
  return {
    data: { academic_session_id: "sess1", date, slots },
    meta: undefined,
    requestId: "req-my",
    status: 200,
  };
}

describe("MyTimetableScreen", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockGet.mockResolvedValue(answer([MATHS]));
  });

  it("renders the caller's own week from the names the endpoint returned", async () => {
    renderWithProviders(<MyTimetableScreen />);

    expect(await screen.findByText("Mathematics")).toBeInTheDocument();
    expect(screen.getByText("Bilal Ahmed")).toBeInTheDocument();
    expect(screen.getByText("L-12")).toBeInTheDocument();
    expect(screen.getByText("Grade 7 A")).toBeInTheDocument();
    expect(screen.getByText("Period 1")).toBeInTheDocument();
  });

  it("asks without a date for the base week", async () => {
    renderWithProviders(<MyTimetableScreen />);

    await screen.findByText("Mathematics");
    expect(mockGet).toHaveBeenCalledWith("/timetables/my", {});
  });

  it("asks for a specific date once one is picked", async () => {
    renderWithProviders(<MyTimetableScreen />);
    await screen.findByText("Mathematics");

    fireEvent.change(screen.getByLabelText("Show cover for"), {
      target: { value: "2026-09-08" },
    });

    await waitFor(() => {
      expect(mockGet).toHaveBeenLastCalledWith("/timetables/my", {
        query: { date: "2026-09-08" },
      });
    });
  });

  it("shows the covering teacher, not the absent one, for a substituted cell", async () => {
    mockGet.mockResolvedValue(answer([MATHS, COVERED_SCIENCE], "2026-09-08"));
    renderWithProviders(<MyTimetableScreen />);

    expect(await screen.findByText("Science")).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /Period 2/ });
    expect(within(row).getByText("Sana Iqbal")).toBeInTheDocument();
    expect(within(row).queryByText("Bilal Ahmed")).not.toBeInTheDocument();
    expect(within(row).getByText("Covered")).toBeInTheDocument();
  });

  it("marks the cells with nothing scheduled as free", async () => {
    renderWithProviders(<MyTimetableScreen />);

    await screen.findByText("Mathematics");
    // Monday is filled; the other four default columns are not.
    expect(screen.getAllByText("Free")).toHaveLength(4);
  });

  it("orders the period rows by the daily sequence, not by arrival", async () => {
    mockGet.mockResolvedValue(answer([COVERED_SCIENCE, MATHS]));
    renderWithProviders(<MyTimetableScreen />);

    await screen.findByText("Mathematics");
    const headers = screen.getAllByRole("rowheader").map((cell) => cell.textContent);
    expect(headers[0]).toContain("Period 1");
    expect(headers[1]).toContain("Period 2");
  });

  it("tells a student with no published timetable so, rather than showing an empty grid", async () => {
    mockGet.mockResolvedValue(answer([]));
    renderWithProviders(<MyTimetableScreen />);

    expect(await screen.findByText("You have no published timetable yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders the error envelope when the request fails", async () => {
    mockGet.mockRejectedValue(
      new ApiError({
        code: "server_error",
        message: "boom",
        status: 500,
        url: "/timetables/my",
        requestId: "req-3",
      }),
    );
    renderWithProviders(<MyTimetableScreen />);

    expect(await screen.findByText(/went wrong on our side/i)).toBeInTheDocument();
    expect(screen.getByText(/Reference: req-3/)).toBeInTheDocument();
  });
});
