import { ApiError } from "@schoolhub/api-client";
import type { PermissionKey } from "@schoolhub/types";
import { screen, waitFor } from "@testing-library/react";
import type { TeacherLoadSummaryRow } from "@/features/academics/academics-types";
import { useSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";
import { apiResult, makeUser, renderWithProviders } from "@/test-utils";
import { TeacherLoadChart, toTeacherLoadRows } from "./teacher-load-chart";

jest.mock("@/hooks/use-session", () => ({ useSession: jest.fn() }));
jest.mock("@/lib/auth", () => ({ apiClient: { get: jest.fn() } }));

const mockUseSession = useSession as jest.MockedFunction<typeof useSession>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

const FULL_ACCESS: PermissionKey[] = [
  "academics.teacher-allocation.view",
  "school.academic-session.view",
];

const CURRENT_SESSION = { id: "sess-1", name: "2026-27", status: "active", is_current: true };

/** Recharts marks, by the class names it puts on them — the same handle `packages/ui`'s own chart test uses. */
const BAR = ".recharts-bar-rectangle";

function makeRow(overrides: Partial<TeacherLoadSummaryRow> = {}): TeacherLoadSummaryRow {
  return {
    staff_id: "staff-1",
    name: "Ayesha Khan",
    weekly_periods: 18,
    allocations: 4,
    over_norm: false,
    ...overrides,
  };
}

function signIn(permissions: PermissionKey[]) {
  mockUseSession.mockReturnValue({
    user: makeUser({ permissions }),
    isLoading: false,
    isAuthenticated: true,
    isUnavailable: false,
    error: null,
    refetch: jest.fn(),
  });
}

function respond(rows: TeacherLoadSummaryRow[], sessions: unknown[] = [CURRENT_SESSION]) {
  mockGet.mockImplementation((path: string) => {
    if (path === "/academic-sessions") return Promise.resolve(apiResult(sessions));
    return Promise.resolve(apiResult(rows));
  });
}

describe("TeacherLoadChart", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockUseSession.mockReset();
    signIn(FULL_ACCESS);
  });

  it("renders nothing for a viewer without the allocation view key", () => {
    signIn(["students.student.view"]);
    const { container } = renderWithProviders(<TeacherLoadChart />);

    expect(container).toBeEmptyDOMElement();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("renders a chart-shaped skeleton while the aggregate is in flight", () => {
    mockGet.mockReturnValue(new Promise(() => undefined));
    const { container } = renderWithProviders(<TeacherLoadChart />);

    expect(screen.getByText("Teaching load this week")).toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(BAR)).toHaveLength(0);
  });

  it("names the plot for assistive tech, which cannot see inside a role=img", async () => {
    respond([makeRow()]);
    renderWithProviders(<TeacherLoadChart />);

    expect(await screen.findByRole("img", { name: "Teaching load this week" })).toBeInTheDocument();
  });

  it("draws one bar per teacher", async () => {
    respond([
      makeRow({ staff_id: "a", name: "Ayesha Khan", weekly_periods: 18 }),
      makeRow({ staff_id: "b", name: "Bilal Ahmed", weekly_periods: 26, over_norm: true }),
      makeRow({ staff_id: "c", name: "Chandni Raza", weekly_periods: 22 }),
    ]);

    const { container } = renderWithProviders(<TeacherLoadChart />);

    await waitFor(() => {
      expect(container.querySelectorAll(BAR)).toHaveLength(3);
    });
    // The names are on the category axis in the running app, but Recharts places tick
    // text from measured layout and `jest.setup.ts` stubs every element's
    // `getBoundingClientRect` to a fixed 640×320 — so under jsdom those `<text>` nodes
    // come back empty. The ordering is asserted against `toTeacherLoadRows` below, which
    // is where this component actually decides it.
  });

  it("draws a bar for an over-norm teacher like any other", async () => {
    respond([
      makeRow({ staff_id: "a", name: "Ayesha Khan", weekly_periods: 18 }),
      makeRow({ staff_id: "b", name: "Bilal Ahmed", weekly_periods: 26, over_norm: true }),
    ]);

    const { container } = renderWithProviders(<TeacherLoadChart />);

    // Over-norm changes the bar's slot, never whether it is drawn — the finding itself
    // lives in the callout below the plot, asserted in the next test.
    await waitFor(() => {
      expect(container.querySelectorAll(BAR)).toHaveLength(2);
    });
    // No assertion on the bar labels here. They render in the browser — a screenshot of
    // the running app shows a figure beside every bar — but `LabelList` is placed from
    // measured layout, and `jest.setup.ts` stubs every element's getBoundingClientRect
    // to a fixed 640x320, so the <text> never lands. Worse, recharts keeps a hidden
    // #recharts_measurement_span in the body holding the last string it measured, so
    // getByText for one of these figures can MATCH THAT and pass while asserting
    // nothing. The figures are asserted against the pure row builder below instead.
  });

  it("states an over-norm teacher in words, never by the bar colour alone", async () => {
    respond([
      makeRow({ staff_id: "a", name: "Ayesha Khan", weekly_periods: 30, over_norm: true }),
      makeRow({ staff_id: "b", name: "Bilal Ahmed", weekly_periods: 12 }),
    ]);

    renderWithProviders(<TeacherLoadChart />);

    expect(await screen.findByText("Over norm")).toBeInTheDocument();
    // Named, and with the load spelled out — the finding survives outside the plot, which
    // `role="img"` closes to a screen reader.
    const finding = screen.getByText("Over norm").closest("li");
    expect(finding?.textContent).toContain("Ayesha Khan");
    expect(finding?.textContent).toContain("30 periods");
    // Bilal is within norm, so he is not in the callout.
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("says how many teachers it left out rather than silently truncating", async () => {
    respond(
      Array.from({ length: 11 }, (_, index) =>
        makeRow({
          staff_id: `staff-${String(index)}`,
          name: `Teacher ${String(index)}`,
          weekly_periods: 20 - index,
        }),
      ),
    );

    const { container } = renderWithProviders(<TeacherLoadChart />);

    expect(await screen.findByText("3 more teachers not shown.")).toBeInTheDocument();
    await waitFor(() => {
      expect(container.querySelectorAll(BAR)).toHaveLength(8);
    });
  });

  it("renders an empty state, not an error, when no teacher is allocated yet", async () => {
    respond([]);
    renderWithProviders(<TeacherLoadChart />);

    expect(await screen.findByText("No teaching load yet")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says the school is between sessions rather than calling the endpoint without one", async () => {
    respond([], []);
    renderWithProviders(<TeacherLoadChart />);

    expect(await screen.findByText("No current academic session")).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).not.toHaveBeenCalledWith(
      "/teacher-subject-allocations/load-summary",
      expect.anything(),
    );
  });

  it("falls back to the active session when none is flagged current", async () => {
    respond([makeRow()], [{ ...CURRENT_SESSION, is_current: false }]);
    renderWithProviders(<TeacherLoadChart />);

    // Asserted on the request rather than on the axis: which session was resolved is the
    // decision, and the query parameter is where it is observable.
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith("/teacher-subject-allocations/load-summary", {
        query: { academic_session_id: "sess-1" },
      });
    });
    expect(await screen.findByText("18")).toBeInTheDocument();
  });

  it("reports a failed read through the error envelope", async () => {
    mockGet.mockRejectedValue(
      new ApiError({ code: "server_error", message: "boom", status: 500, url: "/x" }),
    );

    renderWithProviders(<TeacherLoadChart />);

    expect(
      await screen.findByText("Something went wrong on our side. The team has been notified."),
    ).toBeInTheDocument();
  });
});

/**
 * The ordering, the cut and the slot assignment, tested where they are decided.
 *
 * Recharts renders its category-axis text from measured layout, which jsdom has none of
 * (`jest.setup.ts` stubs `getBoundingClientRect` to a fixed 640×320 for every element),
 * so the rendered chart cannot answer "which teacher is on which row". The component
 * hands that decision to this function, so this is the layer that can.
 */
describe("toTeacherLoadRows", () => {
  it("orders by load, heaviest first, and breaks ties on name so the order is stable", () => {
    const { visible } = toTeacherLoadRows([
      makeRow({ staff_id: "a", name: "Ayesha Khan", weekly_periods: 18 }),
      makeRow({ staff_id: "b", name: "Bilal Ahmed", weekly_periods: 26 }),
      makeRow({ staff_id: "c", name: "Chandni Raza", weekly_periods: 22 }),
      makeRow({ staff_id: "d", name: "Adnan Sethi", weekly_periods: 26 }),
    ]);

    expect(visible.map((row) => row.name)).toEqual([
      "Adnan Sethi",
      "Bilal Ahmed",
      "Chandni Raza",
      "Ayesha Khan",
    ]);
  });

  it("caps the plot and counts what it left out", () => {
    const { visible, remainder } = toTeacherLoadRows(
      Array.from({ length: 11 }, (_, index) =>
        makeRow({
          staff_id: `staff-${String(index)}`,
          name: `Teacher ${String(index)}`,
          weekly_periods: 20 - index,
        }),
      ),
    );

    expect(visible).toHaveLength(8);
    expect(remainder).toBe(3);
    // The cut is by load, not by arrival: the eight heaviest are the eight that matter.
    expect(visible.at(-1)?.load).toBe(13);
  });

  it("puts the exception in slot 5 and everything else in slot 1", () => {
    const { visible, overNorm } = toTeacherLoadRows([
      makeRow({ staff_id: "a", name: "Ayesha Khan", weekly_periods: 30, over_norm: true }),
      makeRow({ staff_id: "b", name: "Bilal Ahmed", weekly_periods: 12 }),
    ]);

    expect(visible.map((row) => row.fill)).toEqual(["var(--color-overNorm)", "var(--color-load)"]);
    // The same rows the callout names in words — colour is never the only carrier.
    expect(overNorm.map((row) => row.name)).toEqual(["Ayesha Khan"]);
  });

  it("answers an empty, valid shape for no teachers at all", () => {
    expect(toTeacherLoadRows([])).toEqual({ visible: [], overNorm: [], remainder: 0 });
  });
});
