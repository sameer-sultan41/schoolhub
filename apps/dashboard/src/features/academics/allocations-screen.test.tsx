import { ApiError, type ApiResult } from "@schoolhub/api-client";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AllocationsScreen } from "@/features/academics/allocations-screen";
import { usePermission } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";
import { renderWithProviders } from "@/test-utils";

jest.mock("@/lib/auth", () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("@/hooks/use-session", () => ({
  usePermission: jest.fn(() => false),
  useAnyPermission: jest.fn(() => false),
}));
jest.mock("next/navigation", () => ({ usePathname: () => "/academics/allocations" }));
jest.mock("@/features/students/use-reference-data", () => ({
  useAcademicSessions: () => ({ data: [{ id: "sess1", name: "2026-27" }] }),
  useClasses: () => ({ data: [{ id: "class1", name: "Grade 7" }] }),
}));
jest.mock("@/features/academics/use-academics-reference-data", () => ({
  useSections: () => ({ data: [{ id: "sec1", name: "A", class_id: "class1" }] }),
  useSubjects: () => ({ data: [{ id: "sub1", name: "Mathematics" }] }),
  useTeachingStaff: () => ({
    data: [{ id: "staff1", employee_number: "EMP-1", first_name: "Bilal", last_name: "Ahmed" }],
  }),
}));
// Both have their own specs; stubbing them keeps this one about the list.
jest.mock("@/features/academics/allocation-form", () => ({
  AllocationForm: () => <div data-testid="allocation-form" />,
}));
jest.mock("@/features/academics/teacher-load-summary", () => ({
  TeacherLoadSummary: ({ academicSessionId }: { academicSessionId: string }) => (
    <div data-testid="load-summary" data-session-id={academicSessionId} />
  ),
}));

// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockPatch = apiClient.patch as jest.MockedFunction<typeof apiClient.patch>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockDelete = apiClient.delete as jest.MockedFunction<typeof apiClient.delete>;
const mockUsePermission = usePermission as jest.MockedFunction<typeof usePermission>;

const CURRENT_PRIMARY = {
  id: "alloc1",
  academic_session_id: "sess1",
  section_id: "sec1",
  subject_id: "sub1",
  staff_id: "staff1",
  is_primary: true,
  weekly_periods: 6,
  effective_from: null,
  effective_to: null,
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
};

const ENDED_CO_TEACHER = {
  ...CURRENT_PRIMARY,
  id: "alloc2",
  is_primary: false,
  weekly_periods: null,
  effective_from: "2026-04-01",
  effective_to: "2026-06-30",
};

function page(items: unknown[], nextCursor: string | null = null): ApiResult<unknown> {
  return {
    data: items,
    meta: { pagination: { next_cursor: nextCursor, previous_cursor: null, page_size: 25 } },
    requestId: "req-list",
    status: 200,
  };
}

describe("AllocationsScreen", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
    mockUsePermission.mockReturnValue(false);
  });

  it("renders a current primary allocation with its resolved names", async () => {
    mockGet.mockResolvedValue(page([CURRENT_PRIMARY]));

    renderWithProviders(<AllocationsScreen />);

    expect(await screen.findByText("Bilal Ahmed")).toBeInTheDocument();
    expect(screen.getByText("Grade 7 A")).toBeInTheDocument();
    expect(screen.getByText("Mathematics")).toBeInTheDocument();
    expect(screen.getByText("Primary")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
  });

  it("renders an end-dated co-teacher row", async () => {
    mockGet.mockResolvedValue(page([ENDED_CO_TEACHER]));

    renderWithProviders(<AllocationsScreen />);

    expect(await screen.findByText("Co-teacher")).toBeInTheDocument();
    expect(screen.getByText("Ended 2026-06-30")).toBeInTheDocument();
  });

  it("shows the translated empty state", async () => {
    mockGet.mockResolvedValue(page([]));

    renderWithProviders(<AllocationsScreen />);

    expect(await screen.findByText("No allocations found.")).toBeInTheDocument();
  });

  it("renders the ApiError envelope instead of the table on failure", async () => {
    mockGet.mockRejectedValue(
      new ApiError({
        code: "server_error",
        message: "boom",
        status: 500,
        url: "/teacher-subject-allocations",
        requestId: "req-2",
      }),
    );

    renderWithProviders(<AllocationsScreen />);

    expect(await screen.findByText(/went wrong on our side/i)).toBeInTheDocument();
    expect(screen.getByText(/Reference: req-2/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("hides the create, end and remove controls without permission", async () => {
    mockGet.mockResolvedValue(page([CURRENT_PRIMARY]));

    renderWithProviders(<AllocationsScreen />);

    await screen.findByText("Bilal Ahmed");
    expect(screen.queryByTestId("allocation-form")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "End" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("prompts for a session before showing the load summary", async () => {
    mockGet.mockResolvedValue(page([CURRENT_PRIMARY]));
    const user = userEvent.setup();

    renderWithProviders(<AllocationsScreen />);
    await screen.findByText("Bilal Ahmed");

    expect(
      screen.getByText("Choose a single academic session to see per-teacher load."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("load-summary")).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Academic session" }));
    await user.click(await screen.findByRole("option", { name: "2026-27" }));

    expect(await screen.findByTestId("load-summary")).toHaveAttribute("data-session-id", "sess1");
    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query).toMatchObject({
        academic_session_id: "sess1",
      });
    });
  });

  it("filters by teacher", async () => {
    mockGet.mockResolvedValue(page([CURRENT_PRIMARY]));
    const user = userEvent.setup();

    renderWithProviders(<AllocationsScreen />);
    await screen.findByText("Bilal Ahmed");

    await user.click(screen.getByRole("combobox", { name: "Teacher" }));
    await user.click(await screen.findByRole("option", { name: "Bilal Ahmed" }));

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query).toMatchObject({ staff_id: "staff1" });
    });
  });

  it("pages forward by cursor", async () => {
    mockGet.mockResolvedValue(page([CURRENT_PRIMARY], "cursor-2"));

    renderWithProviders(<AllocationsScreen />);
    await screen.findByText("Bilal Ahmed");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query?.cursor).toBe("cursor-2");
    });
  });

  it("end-dates an allocation rather than deleting it", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(page([CURRENT_PRIMARY]));
    mockPatch.mockResolvedValue({ data: {}, meta: undefined, requestId: null, status: 200 });
    const user = userEvent.setup();

    renderWithProviders(<AllocationsScreen />);
    await user.click(await screen.findByRole("button", { name: "End" }));

    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "End" });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("Effective to"), {
      target: { value: "2026-06-30" },
    });
    await user.click(within(dialog).getByRole("button", { name: "End" }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith("/teacher-subject-allocations/alloc1", {
        effective_to: "2026-06-30",
      });
    });
  });

  it("removes an allocation entered by mistake", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(page([CURRENT_PRIMARY]));
    mockDelete.mockResolvedValue({ data: null, meta: undefined, requestId: null, status: 204 });
    const user = userEvent.setup();

    renderWithProviders(<AllocationsScreen />);
    await user.click(await screen.findByRole("button", { name: "Remove" }));

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith("/teacher-subject-allocations/alloc1");
    });
  });

  it("renders the envelope inside the remove dialog when the server refuses", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(page([CURRENT_PRIMARY]));
    mockDelete.mockRejectedValue(
      new ApiError({
        code: "conflict",
        message: "in use",
        status: 409,
        url: "/teacher-subject-allocations/alloc1",
      }),
    );
    const user = userEvent.setup();

    renderWithProviders(<AllocationsScreen />);
    await user.click(await screen.findByRole("button", { name: "Remove" }));

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    expect(await screen.findByText(/conflicts with the current data/i)).toBeInTheDocument();
  });
});
