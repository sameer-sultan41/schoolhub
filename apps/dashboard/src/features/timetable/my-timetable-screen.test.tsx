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
  substitution: null,
};

// The wire shape `EffectiveSlotSerializer.get_substitution` actually returns: a
// nested overlay or null, never flat `substitute_*` columns on the slot. A
// fixture that invented flat ones let the screen read a field the API has never
// sent, and every assertion below passed against a cell that renders the absent
// teacher in production.
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
  substitution: {
    id: "sub-1",
    date: "2026-09-08",
    absent_staff_id: "staff1",
    substitute_staff_id: "staff9",
    substitute_staff_name: "Sana Iqbal",
    room_id: "room9",
    room_name: "Lab 2",
    reason: "Sick leave",
  },
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

  // §6's ad-hoc room change lives on the overlay, so a covered cell read against
  // the base row sends the student to a room the class is not in.
  it("sends the student to the room the cover moved the class to", async () => {
    mockGet.mockResolvedValue(answer([MATHS, COVERED_SCIENCE], "2026-09-08"));
    renderWithProviders(<MyTimetableScreen />);

    await screen.findByText("Science");
    const row = screen.getByRole("row", { name: /Period 2/ });
    expect(within(row).getByText("Lab 2")).toBeInTheDocument();
    expect(within(row).queryByText("L-12")).not.toBeInTheDocument();
  });

  it("keeps the slot's own room when the cover did not move the class", async () => {
    mockGet.mockResolvedValue(
      answer(
        [
          {
            ...COVERED_SCIENCE,
            substitution: { ...COVERED_SCIENCE.substitution, room_id: null, room_name: null },
          },
        ],
        "2026-09-08",
      ),
    );
    renderWithProviders(<MyTimetableScreen />);

    await screen.findByText("Science");
    const row = screen.getByRole("row", { name: /Period 2/ });
    expect(within(row).getByText("L-12")).toBeInTheDocument();
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

    expect(await screen.findByText("No timetable published yet")).toBeInTheDocument();
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
