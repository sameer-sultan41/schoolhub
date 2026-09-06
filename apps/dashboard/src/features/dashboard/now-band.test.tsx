import { ApiError } from "@schoolhub/api-client";
import type { PermissionKey } from "@schoolhub/types";
import { screen, waitFor } from "@testing-library/react";
import type { MyTimetableSlot, PeriodRecord } from "@/features/timetable/timetable-types";
import { useSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";
import { apiResult, makeUser, renderWithProviders } from "@/test-utils";
import { NowBand } from "./now-band";
import { weekdayOf } from "./use-school-day";

jest.mock("@/hooks/use-session", () => ({ useSession: jest.fn() }));
jest.mock("@/lib/auth", () => ({ apiClient: { get: jest.fn() } }));

const mockUseSession = useSession as jest.MockedFunction<typeof useSession>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

/**
 * Fixtures are derived from the real clock rather than from a frozen one.
 *
 * Faking time would mean faking `requestAnimationFrame` too, which is what the marker's
 * animation runs on — a suite that stubs the clock ends up asserting against a component
 * whose one motion moment can never start. Deriving "a period happening right now" from
 * `new Date()` keeps every assertion below deterministic at any hour CI happens to run,
 * including the two edges (just after midnight, just before it) that a hardcoded
 * `10:00–10:45` fixture would fail at.
 */
const NOW = new Date();
const NOW_MINUTES = NOW.getHours() * 60 + NOW.getMinutes();
const LAST_MINUTE_OF_DAY = 24 * 60 - 1;

function asTime(minutes: number): string {
  const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
  return `${hours}:${String(minutes % 60).padStart(2, "0")}:00`;
}

/** A window guaranteed to contain this moment, wherever in the day it falls. */
const CURRENT_START = Math.min(Math.max(NOW_MINUTES - 10, 0), LAST_MINUTE_OF_DAY - 30);
const CURRENT_END = CURRENT_START + 30;

/** A window guaranteed NOT to contain this moment: the far end of the day from now. */
const ELSEWHERE_START = NOW_MINUTES >= 12 * 60 ? 0 : 23 * 60;
const ELSEWHERE_END = ELSEWHERE_START + 30;

function makeSlot(overrides: Partial<MyTimetableSlot> = {}): MyTimetableSlot {
  return {
    id: "slot-1",
    day_of_week: weekdayOf(NOW),
    period_id: "p-now",
    period_name: "Period 3",
    period_sequence: 3,
    start_time: asTime(CURRENT_START),
    end_time: asTime(CURRENT_END),
    section_id: "sec-1",
    section_name: "Grade 5-A",
    subject_id: "sub-1",
    subject_name: "Mathematics",
    staff_id: "staff-1",
    staff_name: "Ayesha Khan",
    room_id: "room-1",
    room_name: "Room 12",
    notes: null,
    substitution: null,
    ...overrides,
  };
}

function makeBreak(): PeriodRecord {
  return {
    id: "p-break",
    campus_id: null,
    name: "Morning break",
    sequence: 2,
    start_time: asTime(ELSEWHERE_START),
    end_time: asTime(ELSEWHERE_END),
    is_break: true,
    weekdays: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function signIn(permissions: PermissionKey[], roles: { slug: string }[] = []) {
  mockUseSession.mockReturnValue({
    user: makeUser({
      full_name: "Ayesha Khan",
      permissions,
      roles: roles.map((role, index) => ({
        id: `r${String(index)}`,
        slug: role.slug,
        name: role.slug,
        is_custom: false,
      })),
    }),
    isLoading: false,
    isAuthenticated: true,
    isUnavailable: false,
    error: null,
    refetch: jest.fn(),
  });
}

function respond(timetableSlots: MyTimetableSlot[], periods: PeriodRecord[] = []) {
  mockGet.mockImplementation((path: string) => {
    if (path === "/timetables/my") {
      return Promise.resolve(
        apiResult({ academic_session_id: "s1", date: "2026-09-09", slots: timetableSlots }),
      );
    }
    return Promise.resolve(apiResult(periods));
  });
}

describe("NowBand", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockUseSession.mockReset();
    signIn(["timetable.timetable.view"]);
  });

  it("renders nothing at all for a viewer with no timetable permission", () => {
    signIn(["students.student.view"]);
    const { container } = renderWithProviders(<NowBand />);

    expect(container).toBeEmptyDOMElement();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("shows a placeholder strip while the day is in flight", () => {
    mockGet.mockReturnValue(new Promise(() => undefined));
    const { container } = renderWithProviders(<NowBand />);

    expect(screen.getByText("Welcome back, Ayesha")).toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(7);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("draws one block per period, weighted by its own duration", async () => {
    respond([
      makeSlot(),
      makeSlot({
        id: "slot-2",
        period_id: "p-later",
        period_name: "Period 4",
        start_time: asTime(ELSEWHERE_START),
        end_time: asTime(ELSEWHERE_END),
      }),
    ]);

    renderWithProviders(<NowBand />);

    const blocks = await screen.findAllByRole("listitem");
    expect(blocks).toHaveLength(2);
    // A 30-minute block and a 30-minute block weigh the same; the point is that the
    // weight is the duration, not a constant.
    expect(blocks.map((block) => block.style.flexGrow)).toEqual(["30", "30"]);
  });

  it("marks the live block with aria-current=time and expands its detail", async () => {
    respond([makeSlot()]);
    renderWithProviders(<NowBand />);

    await waitFor(() => {
      expect(
        screen.getByText("Grade 5-A · Mathematics · Ayesha Khan · Room 12"),
      ).toBeInTheDocument();
    });

    const live = screen.getAllByRole("listitem").find((item) => item.getAttribute("aria-current"));
    expect(live?.getAttribute("aria-current")).toBe("time");
    expect(screen.getByText("Now")).toBeInTheDocument();
  });

  it("never claims a role=status — the impersonation banner already owns that role", async () => {
    respond([makeSlot()]);
    renderWithProviders(<NowBand />);

    await screen.findByText("Now");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("badges a covered period and shows the substitute rather than the absent teacher", async () => {
    respond([
      makeSlot({
        substitution: {
          id: "sub-1",
          date: "2026-09-09",
          absent_staff_id: "staff-1",
          substitute_staff_id: "staff-2",
          substitute_staff_name: "Bilal Ahmed",
          room_id: null,
          room_name: null,
          reason: "Sick leave",
        },
      }),
    ]);

    renderWithProviders(<NowBand />);

    expect(await screen.findByText("Covered by another teacher")).toBeInTheDocument();
    expect(screen.getByText(/Bilal Ahmed/)).toBeInTheDocument();
    expect(screen.queryByText(/Ayesha Khan · Room 12/)).not.toBeInTheDocument();
  });

  it("says so plainly between periods instead of pretending a block is live", async () => {
    respond([], [makeBreak()]);
    renderWithProviders(<NowBand />);

    expect(await screen.findByText("Between periods right now.")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("renders an empty state, not an error, when nothing is scheduled today", async () => {
    respond([]);
    renderWithProviders(<NowBand />);

    expect(await screen.findByText("Nothing scheduled today")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open my timetable" })).toHaveAttribute(
      "href",
      "/timetable/my",
    );
  });

  it("does not ask for the bell schedule as a student — the API refuses it either way", async () => {
    respond([makeSlot()], [makeBreak()]);
    signIn(["timetable.timetable.view"], [{ slug: "student" }]);

    renderWithProviders(<NowBand />);

    await screen.findByText("Now");
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith("/timetables/my", expect.anything());
  });

  it("reports a failed timetable read through the error envelope", async () => {
    mockGet.mockRejectedValue(
      new ApiError({ code: "server_error", message: "boom", status: 500, url: "/timetables/my" }),
    );

    renderWithProviders(<NowBand />);

    expect(
      await screen.findByText("Something went wrong on our side. The team has been notified."),
    ).toBeInTheDocument();
  });
});
