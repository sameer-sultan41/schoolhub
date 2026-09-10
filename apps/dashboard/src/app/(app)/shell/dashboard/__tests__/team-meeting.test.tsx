import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils";
import { Services } from "@/services";
import { TeamMeeting } from "../team-meeting";

jest.mock("@/services", () => ({
  Services: { dashboard: { fetchMyTimetable: jest.fn() } },
}));

const mockFetchMyTimetable = Services.dashboard.fetchMyTimetable as jest.MockedFunction<
  typeof Services.dashboard.fetchMyTimetable
>;

/** Wednesday 2026-09-09, 10:20 local. `day_of_week` is Monday-based, so Wednesday is 2. */
const WEDNESDAY_MID_MORNING = new Date(2026, 8, 9, 10, 20);
const WEDNESDAY = 2;

describe("TeamMeeting", () => {
  beforeEach(() => {
    mockFetchMyTimetable.mockReset();
    // Fakes only `Date` — leaving setTimeout/microtasks real, since `@testing-library`'s
    // `findBy*`/`waitFor` polling would otherwise hang forever waiting for a fake timer
    // nothing in this test ever advances.
    jest.useFakeTimers({
      doNotFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "setImmediate",
        "clearImmediate",
        "queueMicrotask",
        "nextTick",
        "performance",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "requestIdleCallback",
        "cancelIdleCallback",
      ],
    });
    jest.setSystemTime(WEDNESDAY_MID_MORNING);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("shows a skeleton while the timetable is in flight", () => {
    mockFetchMyTimetable.mockReturnValue(new Promise(() => undefined));
    const { container } = renderWithProviders(<TeamMeeting />);

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("shows the soonest slot today that hasn't ended yet", async () => {
    mockFetchMyTimetable.mockResolvedValue([
      {
        id: "slot-past",
        day_of_week: WEDNESDAY,
        start_time: "08:00:00",
        end_time: "08:45:00",
        section_name: "Grade 4-A",
        subject_name: "Science",
        staff_name: null,
        room_name: null,
      },
      {
        id: "slot-next",
        day_of_week: WEDNESDAY,
        start_time: "11:00:00",
        end_time: "11:45:00",
        section_name: "Grade 5-A",
        subject_name: "Mathematics",
        staff_name: "Ayesha Khan",
        room_name: "Room 12",
      },
      {
        id: "slot-tomorrow",
        day_of_week: WEDNESDAY + 1,
        start_time: "09:00:00",
        end_time: "09:45:00",
        section_name: "Grade 6-A",
        subject_name: "History",
        staff_name: null,
        room_name: null,
      },
    ]);

    renderWithProviders(<TeamMeeting />);

    expect(await screen.findByText("Mathematics")).toBeInTheDocument();
    expect(screen.getByText("11:00 - 11:45")).toBeInTheDocument();
    expect(screen.getByText("Room 12")).toBeInTheDocument();
    expect(screen.getByText("Grade 5-A · Ayesha Khan")).toBeInTheDocument();
    // The already-ended slot and tomorrow's slot are both real rows this panel must
    // filter out, not just an empty fixture that happens to pass.
    expect(screen.queryByText("Science")).not.toBeInTheDocument();
    expect(screen.queryByText("History")).not.toBeInTheDocument();
  });

  it("says there's nothing left today when every slot has already ended", async () => {
    mockFetchMyTimetable.mockResolvedValue([
      {
        id: "slot-past",
        day_of_week: WEDNESDAY,
        start_time: "08:00:00",
        end_time: "08:45:00",
        section_name: "Grade 4-A",
        subject_name: "Science",
        staff_name: null,
        room_name: null,
      },
    ]);

    renderWithProviders(<TeamMeeting />);

    expect(await screen.findByText("No more classes today")).toBeInTheDocument();
  });

  it("says there's nothing left today for an admin account with no personal timetable", async () => {
    mockFetchMyTimetable.mockResolvedValue([]);

    renderWithProviders(<TeamMeeting />);

    expect(await screen.findByText("No more classes today")).toBeInTheDocument();
  });
});
