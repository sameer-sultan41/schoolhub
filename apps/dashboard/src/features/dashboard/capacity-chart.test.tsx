import { ApiError } from "@schoolhub/api-client";
import type { PermissionKey } from "@schoolhub/types";
import { screen, waitFor } from "@testing-library/react";
import type { ClassOption, SectionOption } from "@/features/students/enrollment-types";
import { useSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";
import { apiResult, makeUser, renderWithProviders } from "@/test-utils";
import { CapacityChart, sectionsInPayload } from "./capacity-chart";

jest.mock("@/hooks/use-session", () => ({ useSession: jest.fn() }));
jest.mock("@/lib/auth", () => ({ apiClient: { get: jest.fn() } }));

const mockUseSession = useSession as jest.MockedFunction<typeof useSession>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

const FULL_ACCESS: PermissionKey[] = ["school.section.view", "school.class.view"];

const BAR = ".recharts-bar-rectangle";
const CATEGORY_TICK = ".recharts-yAxis .recharts-cartesian-axis-tick-value";

const CLASSES: ClassOption[] = [
  { id: "c-5", name: "Grade 5", level: 5 },
  { id: "c-4", name: "Grade 4", level: 4 },
];

function makeSection(overrides: Partial<SectionOption> = {}): SectionOption {
  return {
    id: "sec-1",
    name: "A",
    class_id: "c-4",
    campus_id: "camp-1",
    capacity: 30,
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

function respond(sections: SectionOption[], classes: ClassOption[] = CLASSES) {
  mockGet.mockImplementation((path: string) => {
    if (path === "/classes") return Promise.resolve(apiResult(classes));
    return Promise.resolve(apiResult(sections));
  });
}

describe("CapacityChart", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockUseSession.mockReset();
    signIn(FULL_ACCESS);
  });

  it("renders nothing when the viewer can read only half of what it charts", () => {
    signIn(["school.section.view"]);
    const { container } = renderWithProviders(<CapacityChart />);

    expect(container).toBeEmptyDOMElement();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("renders a chart-shaped skeleton while the lists are in flight", () => {
    mockGet.mockReturnValue(new Promise(() => undefined));
    const { container } = renderWithProviders(<CapacityChart />);

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(BAR)).toHaveLength(0);
  });

  it("says places, never enrolment — no endpoint reports enrolled counts per section", () => {
    mockGet.mockReturnValue(new Promise(() => undefined));
    renderWithProviders(<CapacityChart />);

    expect(screen.getByText("Places by class")).toBeInTheDocument();
    // The one thing this chart must never be called. No endpoint reports enrolled
    // counts per section, so a title saying so would be a lie in a shape people trust.
    expect(screen.queryByText(/students per class/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/enrolment by class/i)).not.toBeInTheDocument();
  });

  it("names the plot and its measured axis in words", async () => {
    respond([makeSection()]);
    renderWithProviders(<CapacityChart />);

    expect(await screen.findByRole("img", { name: "Places by class" })).toBeInTheDocument();
    expect(screen.getByText("Capacity, in places")).toBeInTheDocument();
  });

  it("sums section capacity per class, orders by class level, and labels each bar", async () => {
    respond([
      makeSection({ id: "s1", class_id: "c-5", name: "A", capacity: 30 }),
      makeSection({ id: "s2", class_id: "c-5", name: "B", capacity: 28 }),
      makeSection({ id: "s3", class_id: "c-4", name: "A", capacity: 25 }),
    ]);

    const { container } = renderWithProviders(<CapacityChart />);

    await waitFor(() => {
      expect(container.querySelectorAll(BAR)).toHaveLength(2);
    });
    // Grade 4 before Grade 5: entity order, not rank — a chart that reshuffles when a
    // section is added is a chart nobody can read twice.
    expect([...container.querySelectorAll(CATEGORY_TICK)].map((tick) => tick.textContent)).toEqual([
      "Grade 4",
      "Grade 5",
    ]);
    expect(screen.getByText("58")).toBeInTheDocument();
    expect(screen.getByText("25")).toBeInTheDocument();
  });

  it("treats a null capacity as no places set aside rather than as zero students", async () => {
    respond([
      makeSection({ id: "s1", class_id: "c-4", capacity: null }),
      makeSection({ id: "s2", class_id: "c-4", capacity: 20 }),
    ]);

    renderWithProviders(<CapacityChart />);

    expect(await screen.findByText("20")).toBeInTheDocument();
  });

  it("drops a section whose class the reader cannot see instead of inventing a name", async () => {
    respond([makeSection({ id: "s1", class_id: "c-hidden", capacity: 40 })]);
    renderWithProviders(<CapacityChart />);

    expect(await screen.findByText("No capacity recorded")).toBeInTheDocument();
  });

  it("renders an empty state, not an error, when no capacity is recorded", async () => {
    respond([makeSection({ capacity: null })]);
    renderWithProviders(<CapacityChart />);

    expect(await screen.findByText("No capacity recorded")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says how many classes it left out rather than silently truncating", async () => {
    const manyClasses = Array.from({ length: 10 }, (_, index) => ({
      id: `class-${String(index)}`,
      name: `Grade ${String(index + 1)}`,
      level: index + 1,
    }));
    respond(
      manyClasses.map((option, index) =>
        makeSection({ id: `sec-${String(index)}`, class_id: option.id, capacity: 30 }),
      ),
      manyClasses,
    );

    const { container } = renderWithProviders(<CapacityChart />);

    expect(await screen.findByText("2 more classes not shown.")).toBeInTheDocument();
    await waitFor(() => {
      expect(container.querySelectorAll(BAR)).toHaveLength(8);
    });
  });

  it("reports a failed read through the error envelope", async () => {
    mockGet.mockRejectedValue(
      new ApiError({ code: "server_error", message: "boom", status: 500, url: "/sections" }),
    );

    renderWithProviders(<CapacityChart />);

    expect(
      await screen.findByText("Something went wrong on our side. The team has been notified."),
    ).toBeInTheDocument();
  });
});

/**
 * Recharts renders tooltip content only on a real hover, which jsdom cannot produce, so
 * the accessor the tooltip's label line depends on is proven directly — the same shape of
 * workaround `packages/ui/src/components/chart.test.tsx` documents for its own tooltip.
 */
describe("sectionsInPayload", () => {
  it("reads the section count off the hovered datum", () => {
    expect(sectionsInPayload([{ dataKey: "capacity", payload: { sections: 3 } }])).toBe(3);
  });

  it("answers null rather than guessing when the row carries no count", () => {
    expect(sectionsInPayload(undefined)).toBeNull();
    expect(sectionsInPayload([])).toBeNull();
    expect(sectionsInPayload([{ dataKey: "capacity" }])).toBeNull();
    expect(sectionsInPayload([{ dataKey: "capacity", payload: { sections: "3" } }])).toBeNull();
  });
});
