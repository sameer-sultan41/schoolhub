import { fireEvent, screen, waitFor } from "@testing-library/react";

import { Services } from "@/services";
import {
  effectiveSlotRecord,
  PERIOD_2_ID,
} from "@/services/modules/timetable-slots/__tests__/timetable-slots-fixtures";
import { renderWithProviders } from "@/test-utils";

import { MyTimetable } from "../my-timetable";

jest.mock("@/services", () => ({
  Services: { timetableSlots: { fetchMyTimetable: jest.fn() } },
}));

const mockFetchMyTimetable = Services.timetableSlots.fetchMyTimetable as jest.MockedFunction<
  typeof Services.timetableSlots.fetchMyTimetable
>;

describe("MyTimetable", () => {
  beforeEach(() => {
    mockFetchMyTimetable.mockReset();
  });

  it("draws the viewer's week, in period order, with free periods marked", async () => {
    mockFetchMyTimetable.mockResolvedValue([
      effectiveSlotRecord({
        id: "s2",
        period_id: PERIOD_2_ID,
        period_name: "Period 2",
        period_sequence: 2,
        subject_name: "Science",
        day_of_week: 1,
      }),
      effectiveSlotRecord({ id: "s1" }),
    ]);

    renderWithProviders(<MyTimetable />);

    const rows = await screen.findAllByRole("rowheader");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Period 1"),
      expect.stringContaining("Period 2"),
    ]);
    expect(screen.getByText("Science")).toBeInTheDocument();
    expect(screen.getAllByText("Free").length).toBeGreaterThan(0);
    expect(mockFetchMyTimetable).toHaveBeenCalledWith(undefined);
  });

  it("marks cover for a chosen date, with the covering teacher and the moved room", async () => {
    mockFetchMyTimetable.mockImplementation((date) =>
      Promise.resolve([
        effectiveSlotRecord(
          date
            ? {
                substitution: {
                  id: "c1",
                  date,
                  absent_staff_id: "a",
                  substitute_staff_id: "b",
                  substitute_staff_name: "Bilal Khan",
                  room_id: "r2",
                  room_name: "Lab 1",
                  reason: null,
                },
              }
            : {},
        ),
      ]),
    );
    renderWithProviders(<MyTimetable />);
    await screen.findByText("Mathematics");

    fireEvent.change(screen.getByLabelText("Show cover for"), { target: { value: "2026-10-19" } });

    expect(await screen.findByText("Covered by Bilal Khan")).toBeInTheDocument();
    expect(screen.getByText("Grade 5-A · Lab 1")).toBeInTheDocument();
    await waitFor(() => {
      expect(mockFetchMyTimetable).toHaveBeenLastCalledWith("2026-10-19");
    });
  });

  it("shows both classes when two sections share a period (a guardian's two children)", async () => {
    mockFetchMyTimetable.mockResolvedValue([
      effectiveSlotRecord({ id: "a", section_name: "Grade 5-A", subject_name: "Mathematics" }),
      effectiveSlotRecord({ id: "b", section_name: "Grade 2-B", subject_name: "Urdu" }),
    ]);

    renderWithProviders(<MyTimetable />);

    expect(await screen.findByText("Mathematics")).toBeInTheDocument();
    expect(screen.getByText("Urdu")).toBeInTheDocument();
  });

  it("says the week couldn't be loaded when the read fails", async () => {
    mockFetchMyTimetable.mockRejectedValue(new Error("network"));

    renderWithProviders(<MyTimetable />);

    expect(await screen.findByText("Your timetable couldn't be loaded.")).toBeInTheDocument();
  });

  it("says nothing is published yet for an empty week", async () => {
    mockFetchMyTimetable.mockResolvedValue([]);

    renderWithProviders(<MyTimetable />);

    expect(await screen.findByText("No timetable published yet")).toBeInTheDocument();
  });
});
