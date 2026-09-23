import { ApiError } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import type { PermissionKey } from "@schoolhub/types";
import { screen, waitFor } from "@testing-library/react";
import { usePermission } from "@/hooks/use-session";
import { Services } from "@/services";
import { renderWithProviders } from "@/test-utils";
import { SchoolShapePanel } from "./school-shape-panel";

// `<Can>` is this panel's only permission surface — it never calls `useSession` itself.
// Both gate hooks have to be stubbed: `Can` calls each one unconditionally, so a factory
// that names only one replaces the other with undefined and throws inside `Can`.
jest.mock("@/hooks/use-session", () => ({
  usePermission: jest.fn(() => false),
  useAnyPermission: jest.fn(() => false),
}));
jest.mock("@/services", () => ({
  Services: { dashboard: { listCountable: jest.fn(), fetchCountTotal: jest.fn() } },
}));

const mockUsePermission = usePermission as jest.MockedFunction<typeof usePermission>;
const mockListCountable = Services.dashboard.listCountable as jest.MockedFunction<
  typeof Services.dashboard.listCountable
>;
const mockFetchCountTotal = Services.dashboard.fetchCountTotal as jest.MockedFunction<
  typeof Services.dashboard.fetchCountTotal
>;

const EVERY_KEY: PermissionKey[] = [
  "school.class.view",
  "school.section.view",
  "school.subject.view",
  "school.house.view",
  "school.campus.view",
  "timetable.timetable.view",
  "students.student.view",
  "staff.staff.view",
];

function rows(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `id-${String(index)}` }));
}

/** A single-row page carrying the server's own total — what `fetchCountTotal` returns for `/students` and `/staff`. */
function countedPage(total: number): Page<{ id: string }> {
  return {
    items: rows(1),
    pagination: { page: 1, page_size: 1, total_count: total, total_pages: total },
  };
}

/**
 * A single-row page with NO total.
 *
 * A cursor envelope, because that is the only shape that can omit one: counting is
 * opt-in per cursor endpoint, so a list that does not count leaves the field out
 * entirely rather than sending null. Neither tile points at such an endpoint today —
 * this is the guard for the day one does.
 */
function uncountedPage(): Page<{ id: string }> {
  return {
    items: rows(1),
    pagination: { next_cursor: "abc", previous_cursor: null, page_size: 1 },
  };
}

/** Grant exactly this list; every other key answers false, as `<Can>` would in production. */
function signIn(permissions: PermissionKey[]) {
  mockUsePermission.mockImplementation((permission) => permissions.includes(permission));
}

function respond({ studentTotal }: { studentTotal?: number } = { studentTotal: 1280 }) {
  mockFetchCountTotal.mockImplementation((path: string) => {
    if (path === "/students") {
      return Promise.resolve(
        studentTotal === undefined ? uncountedPage() : countedPage(studentTotal),
      );
    }
    return Promise.resolve(countedPage(97)); // "/staff"
  });
  mockListCountable.mockImplementation((path: string) => {
    if (path === "/classes") return Promise.resolve(rows(12));
    if (path === "/sections") return Promise.resolve(rows(34));
    return Promise.resolve(rows(3)); // subjects, rooms, houses, campuses
  });
}

describe("SchoolShapePanel", () => {
  beforeEach(() => {
    mockListCountable.mockReset();
    mockFetchCountTotal.mockReset();
    signIn(EVERY_KEY);
  });

  it("shows one skeleton per tile while the counts are in flight", () => {
    mockListCountable.mockReturnValue(new Promise(() => undefined));
    mockFetchCountTotal.mockReturnValue(new Promise(() => undefined));
    const { container } = renderWithProviders(<SchoolShapePanel />);

    expect(screen.getByText("Your school at a glance")).toBeInTheDocument();
    // Eight tiles, one skeleton each — the figure's own height, so nothing shifts.
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(8);
  });

  it("counts the bounded reference lists and formats them for the locale", async () => {
    respond();
    renderWithProviders(<SchoolShapePanel />);

    await waitFor(() => {
      expect(screen.getByText("12")).toBeInTheDocument();
    });
    expect(screen.getByText("34")).toBeInTheDocument();
    expect(screen.getByText("Campuses")).toBeInTheDocument();
  });

  it("reads the head counts from the server's own total rather than draining the list", async () => {
    respond();
    renderWithProviders(<SchoolShapePanel />);

    expect(await screen.findByText("1,280")).toBeInTheDocument();
    expect(screen.getByText("97")).toBeInTheDocument();
    // One cheap request each — a paged walk of every student to count them is exactly
    // what `total_count` exists to avoid. The exact query params `fetchCountTotal` sends
    // are asserted in dashboard-service.test.ts; here it is enough that this panel asked
    // for the right two paths.
    expect(mockFetchCountTotal).toHaveBeenCalledWith("/students");
    expect(mockFetchCountTotal).toHaveBeenCalledWith("/staff");
  });

  it("says the total is not there rather than inventing a zero when the endpoint omits it", async () => {
    respond({ studentTotal: undefined });
    renderWithProviders(<SchoolShapePanel />);

    expect(await screen.findByText("Not counted yet")).toBeInTheDocument();
    expect(screen.getByText("This list is paged without a total.")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("renders only the tiles the viewer's keys allow", () => {
    signIn(["school.campus.view"]);
    respond();
    renderWithProviders(<SchoolShapePanel />);

    expect(screen.getByText("Campuses")).toBeInTheDocument();
    expect(screen.queryByText("Students")).not.toBeInTheDocument();
    expect(screen.queryByText("Rooms")).not.toBeInTheDocument();
    expect(mockListCountable).toHaveBeenCalledTimes(1);
  });

  it("says a count is unavailable right now — never an error alert — when the read fails", async () => {
    mockListCountable.mockRejectedValue(
      new ApiError({ code: "server_error", message: "boom", status: 500, url: "/classes" }),
    );
    signIn(["school.class.view"]);

    renderWithProviders(<SchoolShapePanel />);

    expect(await screen.findByText("Unavailable right now")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
