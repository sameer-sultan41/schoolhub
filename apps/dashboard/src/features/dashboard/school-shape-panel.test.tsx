import { ApiError, type ApiResult } from "@schoolhub/api-client";
import type { PermissionKey } from "@schoolhub/types";
import { screen, waitFor } from "@testing-library/react";
import { useSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";
import { apiResult, makeUser, renderWithProviders } from "@/test-utils";
import { SchoolShapePanel } from "./school-shape-panel";

jest.mock("@/hooks/use-session", () => ({ useSession: jest.fn() }));
jest.mock("@/lib/auth", () => ({ apiClient: { get: jest.fn() } }));

const mockUseSession = useSession as jest.MockedFunction<typeof useSession>;
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

/** A single-row page carrying (or deliberately omitting) the server's own total. */
function countedPage(total: number | undefined): ApiResult<{ id: string }[]> {
  return {
    data: rows(1),
    meta: {
      pagination: {
        next_cursor: "abc",
        previous_cursor: null,
        page_size: 1,
        ...(total === undefined ? {} : { total_count: total }),
      },
    },
    requestId: null,
    status: 200,
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

function respond({ studentTotal }: { studentTotal?: number } = { studentTotal: 1280 }) {
  mockGet.mockImplementation((path: string) => {
    if (path === "/students") return Promise.resolve(countedPage(studentTotal));
    if (path === "/staff") return Promise.resolve(countedPage(97));
    if (path === "/classes") return Promise.resolve(apiResult(rows(12)));
    if (path === "/sections") return Promise.resolve(apiResult(rows(34)));
    return Promise.resolve(apiResult(rows(3)));
  });
}

describe("SchoolShapePanel", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockUseSession.mockReset();
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
