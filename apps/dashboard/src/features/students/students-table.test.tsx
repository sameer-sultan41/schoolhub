import { ApiError } from "@schoolhub/api-client";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StudentsTable } from "@/features/students/students-table";
import { usePermission } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";
import { offsetPage, renderWithProviders } from "@/test-utils";

jest.mock("@/lib/auth", () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
// StudentsTable never calls useSession itself — it renders <Can>, which reads
// usePermission/useAnyPermission — so those two are the ones to mock.
jest.mock("@/hooks/use-session", () => ({
  usePermission: jest.fn(() => false),
  useAnyPermission: jest.fn(() => false),
}));
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
}));

// apiClient.get's static type comes from the real ApiClient class (the mock
// factory above only changes the runtime value), so typescript-eslint's
// unbound-method rule reads it as a class-method reference — it is not one at
// runtime, it is jest.fn(), so it is safe to reference bare here.
// eslint-disable-next-line @typescript-eslint/unbound-method
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const mockUsePermission = usePermission as jest.MockedFunction<typeof usePermission>;

const STUDENT = {
  id: "s1",
  admission_number: "2026-0001",
  admission_date: "2026-04-01",
  first_name: "Amina",
  last_name: "Khan",
  preferred_name: null,
  status: "active",
};

describe("StudentsTable", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockPush.mockReset();
    mockUsePermission.mockReturnValue(false);
  });

  it("shows skeleton rows while loading", () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<StudentsTable />);

    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
  });

  it("renders rows once data resolves", async () => {
    mockGet.mockResolvedValue(offsetPage([STUDENT], {}, "req-list"));

    renderWithProviders(<StudentsTable />);

    expect(await screen.findByText("2026-0001")).toBeInTheDocument();
    expect(screen.getByText("Amina Khan")).toBeInTheDocument();
  });

  it("shows the translated empty state when the result set is empty", async () => {
    mockGet.mockResolvedValue(offsetPage([], {}, "req-list"));

    renderWithProviders(<StudentsTable />);

    expect(await screen.findByText("No students yet")).toBeInTheDocument();
  });

  it("renders the ApiError envelope on a request failure", async () => {
    mockGet.mockRejectedValue(
      new ApiError({
        code: "server_error",
        message: "boom",
        status: 500,
        url: "/students",
        requestId: "req-1",
      }),
    );

    renderWithProviders(<StudentsTable />);

    expect(await screen.findByText(/went wrong on our side/i)).toBeInTheDocument();
    expect(screen.getByText(/Reference: req-1/)).toBeInTheDocument();
  });

  it("disables the Next button when there is no next page", async () => {
    mockGet.mockResolvedValue(offsetPage([STUDENT], {}, "req-list"));

    renderWithProviders(<StudentsTable />);

    const nextButton = await screen.findByRole("button", { name: "Next" });
    expect(nextButton).toBeDisabled();
  });

  it("clicking a row navigates to that student's detail page", async () => {
    mockGet.mockResolvedValue(offsetPage([STUDENT], {}, "req-list"));

    renderWithProviders(<StudentsTable />);

    const cell = await screen.findByText("Amina Khan");
    fireEvent.click(cell.closest("tr") as HTMLElement);

    expect(mockPush).toHaveBeenCalledWith("/students/s1");
  });

  it("clicking a page number asks the server for that page", async () => {
    // Two pages' worth: the pager only renders numbers when there is somewhere to go.
    mockGet.mockResolvedValue(
      offsetPage([STUDENT], { total_count: 30, page_size: 25 }, "req-list"),
    );

    renderWithProviders(<StudentsTable />);
    await screen.findByText("2026-0001");

    fireEvent.click(screen.getByRole("button", { name: "Go to page 2" }));

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query?.page).toBe(2);
    });
  });

  it("omits the page parameter on page one rather than sending page=1", async () => {
    // A link to the first page of a filtered roster should read the same as the roster.
    mockGet.mockResolvedValue(
      offsetPage([STUDENT], { total_count: 30, page_size: 25 }, "req-list"),
    );

    renderWithProviders(<StudentsTable />);
    await screen.findByText("2026-0001");

    expect(mockGet.mock.calls.at(-1)?.[1]?.query?.page).toBeUndefined();
  });

  it("debounces the search input before it reaches the query", async () => {
    jest.useFakeTimers();
    mockGet.mockResolvedValue(offsetPage([STUDENT], {}, "req-list"));

    renderWithProviders(<StudentsTable />);
    await screen.findByText("2026-0001");
    const callsBeforeTyping = mockGet.mock.calls.length;

    const searchInput = screen.getByLabelText("Search");
    fireEvent.change(searchInput, { target: { value: "Am" } });
    // A second keystroke before the debounce window elapses must clear the
    // first pending commit rather than stacking two — only "Amina" should
    // ever land in the query.
    fireEvent.change(searchInput, { target: { value: "Amina" } });
    expect(searchInput).toHaveValue("Amina");

    // No new request yet: the debounced value hasn't committed.
    expect(mockGet.mock.calls.length).toBe(callsBeforeTyping);

    act(() => {
      jest.advanceTimersByTime(300);
    });
    jest.useRealTimers();

    await waitFor(() => {
      const lastCall = mockGet.mock.calls.at(-1)?.[1];
      expect(lastCall?.query?.search).toBe("Amina");
    });
  });

  it("changing the status filter re-fetches with the selected status", async () => {
    mockGet.mockResolvedValue(offsetPage([STUDENT], {}, "req-list"));

    const user = userEvent.setup();
    renderWithProviders(<StudentsTable />);
    await screen.findByText("2026-0001");

    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByRole("option", { name: "Suspended" }));

    await waitFor(() => {
      const lastCall = mockGet.mock.calls.at(-1)?.[1];
      expect(lastCall?.query?.status).toBe("suspended");
    });
  });

  it("Previous returns to the page before, and is disabled on the first", async () => {
    mockGet.mockResolvedValue(
      offsetPage([STUDENT], { total_count: 30, page_size: 25 }, "req-list"),
    );

    renderWithProviders(<StudentsTable />);
    await screen.findByText("2026-0001");

    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Go to page 2" }));
    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query?.page).toBe(2);
    });

    const previous = screen.getByRole("button", { name: "Previous page" });
    await waitFor(() => {
      expect(previous).not.toBeDisabled();
    });
    fireEvent.click(previous);

    await waitFor(() => {
      // Back to page one, which is the absence of the parameter rather than page=1.
      expect(mockGet.mock.calls.at(-1)?.[1]?.query?.page).toBeUndefined();
    });
  });

  it("enables the ID-card action once a row is selected", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(offsetPage([STUDENT], {}, "req-list"));

    const user = userEvent.setup();
    renderWithProviders(<StudentsTable />);

    await screen.findByText("2026-0001");
    expect(screen.getByRole("button", { name: "Generate ID cards (0)" })).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: "Select this student" }));

    expect(screen.getByRole("button", { name: "Generate ID cards (1)" })).toBeEnabled();
  });

  it("unchecking a selected row disables the action again", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(offsetPage([STUDENT], {}, "req-list"));

    const user = userEvent.setup();
    renderWithProviders(<StudentsTable />);

    await screen.findByText("2026-0001");
    const rowCheckbox = screen.getByRole("checkbox", { name: "Select this student" });
    await user.click(rowCheckbox);
    expect(screen.getByRole("button", { name: "Generate ID cards (1)" })).toBeEnabled();

    await user.click(rowCheckbox);

    expect(screen.getByRole("button", { name: "Generate ID cards (0)" })).toBeDisabled();
  });

  it("select-all toggles every row on the page, both ways", async () => {
    mockUsePermission.mockReturnValue(true);
    const secondStudent = { ...STUDENT, id: "s2", admission_number: "2026-0002" };
    mockGet.mockResolvedValue(offsetPage([STUDENT, secondStudent], {}, "req-list"));

    const user = userEvent.setup();
    renderWithProviders(<StudentsTable />);

    await screen.findByText("2026-0001");
    const selectAll = screen.getByRole("checkbox", { name: "Select all students on this page" });
    await user.click(selectAll);

    expect(screen.getByRole("button", { name: "Generate ID cards (2)" })).toBeEnabled();

    await user.click(selectAll);

    expect(screen.getByRole("button", { name: "Generate ID cards (0)" })).toBeDisabled();
  });

  it("clears the selection once the generated ID-card job is dismissed", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockImplementation((path: string) => {
      if (path === "/students") {
        return Promise.resolve(offsetPage([STUDENT], {}, "req-list"));
      }
      if (path === "/jobs/job1") {
        return Promise.resolve({
          data: {
            id: "job1",
            job_type: "id-cards.generate",
            status: "succeeded",
            progress: 100,
            result: { result_file_id: "f1", count: 1 },
            error: null,
            started_at: null,
            finished_at: null,
            created_at: "2026-04-01T00:00:00Z",
            updated_at: "2026-04-01T00:00:00Z",
          },
          meta: undefined,
          requestId: null,
          status: 200,
        });
      }
      throw new Error(`unexpected path ${path}`);
    });
    mockPost.mockResolvedValue({
      data: { job_id: "job1" },
      meta: undefined,
      requestId: null,
      status: 200,
    });

    const user = userEvent.setup();
    renderWithProviders(<StudentsTable />);

    await screen.findByText("2026-0001");
    await user.click(screen.getByRole("checkbox", { name: "Select this student" }));
    await user.click(screen.getByRole("button", { name: "Generate ID cards (1)" }));
    await user.click(await screen.findByRole("button", { name: "Dismiss" }));

    expect(screen.getByRole("button", { name: "Generate ID cards (0)" })).toBeDisabled();
  });

  it("offers the create action from inside the empty state, not just the header", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(offsetPage([], {}, "req-list"));

    renderWithProviders(<StudentsTable />);

    await screen.findByText("No students yet");
    expect(screen.getByText("Add your first student, or import a class list.")).toBeInTheDocument();
    // One in the header's action row, one inside the empty state — an empty screen is an
    // invitation to act, so the action is where the reader is already looking.
    expect(screen.getAllByRole("link", { name: "New student" })).toHaveLength(2);
  });

  it("offers no clear control until a filter is actually set", async () => {
    mockGet.mockResolvedValue(offsetPage([STUDENT], {}, "req-list"));

    renderWithProviders(<StudentsTable />);

    await screen.findByText("2026-0001");
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("clearing the filters drops the status from the request", async () => {
    mockGet.mockResolvedValue(offsetPage([STUDENT], {}, "req-list"));

    const user = userEvent.setup();
    renderWithProviders(<StudentsTable />);
    await screen.findByText("2026-0001");

    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByRole("option", { name: "Suspended" }));
    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query?.status).toBe("suspended");
    });

    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query?.status).toBeUndefined();
    });
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("tightens the row height on this table, which is scanned rather than read", async () => {
    mockGet.mockResolvedValue(offsetPage([STUDENT], {}, "req-list"));

    renderWithProviders(<StudentsTable />);

    const cell = await screen.findByText("2026-0001");
    expect(cell.closest("td")).toHaveClass("py-2");
  });
});
