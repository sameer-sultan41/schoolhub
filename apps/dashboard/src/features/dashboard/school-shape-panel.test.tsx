import { ApiError, type ApiResult } from "@schoolhub/api-client";
import type { PermissionKey } from "@schoolhub/types";
import { screen, waitFor } from "@testing-library/react";
import { usePermission } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";
import { apiResult, cursorPage, offsetPage, renderWithProviders } from "@/test-utils";
import { SchoolShapePanel } from "./school-shape-panel";

// `<Can>` is this panel's only permission surface — it never calls `useSession` itself.
// Both gate hooks have to be stubbed: `Can` calls each one unconditionally, so a factory
// that names only one replaces the other with undefined and throws inside `Can`.
jest.mock("@/hooks/use-session", () => ({
  usePermission: jest.fn(() => false),
  useAnyPermission: jest.fn(() => false),
}));
jest.mock("@/lib/auth", () => ({ apiClient: { get: jest.fn() } }));

const mockUsePermission = usePermission as jest.MockedFunction<typeof usePermission>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

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

/**
 * A single-row page carrying the server's own total — what `/students` and `/staff`
 * send now that both page by number.
 */
function countedPage(total: number): ApiResult<{ id: string }[]> {
  return offsetPage(rows(1), { page_size: 1, total_count: total }, "req-count");
}

/**
 * A single-row page with NO total.
 *
 * A cursor envelope, because that is the only shape that can omit one: counting is
 * opt-in per cursor endpoint, so a list that does not count leaves the field out
 * entirely rather than sending null. Neither tile points at such an endpoint today —
 * this is the guard for the day one does.
 */
function uncountedPage(): ApiResult<{ id: string }[]> {
  return cursorPage(rows(1), { next_cursor: "abc", page_size: 1 }, "req-count");
}

/** Grant exactly this list; every other key answers false, as `<Can>` would in production. */
function signIn(permissions: PermissionKey[]) {
  mockUsePermission.mockImplementation((permission) => permissions.includes(permission));
}

function respond({ studentTotal }: { studentTotal?: number } = { studentTotal: 1280 }) {
  mockGet.mockImplementation((path: string) => {
    if (path === "/students") {
      return Promise.resolve(
        studentTotal === undefined ? uncountedPage() : countedPage(studentTotal),
      );
    }
    if (path === "/staff") return Promise.resolve(countedPage(97));
    if (path === "/classes") return Promise.resolve(apiResult(rows(12)));
    if (path === "/sections") return Promise.resolve(apiResult(rows(34)));
    return Promise.resolve(apiResult(rows(3)));
  });
}

describe("SchoolShapePanel", () => {
  beforeEach(() => {
    mockGet.mockReset();
    signIn(EVERY_KEY);
  });

  it("shows one skeleton per tile while the counts are in flight", () => {
    mockGet.mockReturnValue(new Promise(() => undefined));
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
    // what `total_count` exists to avoid.
    expect(mockGet).toHaveBeenCalledWith("/students", { query: { page_size: 1 } });
    expect(mockGet).toHaveBeenCalledWith("/staff", { query: { page_size: 1 } });
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
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("says a count is unavailable right now — never an error alert — when the read fails", async () => {
    mockGet.mockRejectedValue(
      new ApiError({ code: "server_error", message: "boom", status: 500, url: "/classes" }),
    );
    signIn(["school.class.view"]);

    renderWithProviders(<SchoolShapePanel />);

    expect(await screen.findByText("Unavailable right now")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
