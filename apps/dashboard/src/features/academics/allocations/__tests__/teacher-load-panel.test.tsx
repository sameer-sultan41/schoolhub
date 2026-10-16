import { ApiError } from "@schoolhub/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  loadRow,
  OTHER_STAFF_ID,
} from "@/services/modules/teacher-allocations/__tests__/teacher-allocations-fixtures";
import { SESSION_ID } from "@/test-fixtures/academics";
import { renderWithProviders } from "@/test-utils";

import messages from "../../../../../messages/en.json";
import { TeacherLoadPanel } from "../teacher-load-panel";

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: { teacherAllocations: { fetchLoadSummary: jest.fn() } },
}));

const mockFetchLoadSummary = Services.teacherAllocations.fetchLoadSummary as jest.MockedFunction<
  typeof Services.teacherAllocations.fetchLoadSummary
>;

const THIRD_STAFF_ID = "5d6e7f8a-9b0c-4d1e-8f2a-3b4c5d6e7f8a";

const WITHIN = loadRow({ name: "Ayesha Khan", weekly_periods: 18, allocations: 4 });
const OVER = loadRow({
  staff_id: OTHER_STAFF_ID,
  name: "Bilal Ahmed",
  weekly_periods: 36,
  allocations: 6,
  over_norm: true,
});
const ALSO_WITHIN = loadRow({ staff_id: THIRD_STAFF_ID, name: "Zainab Bibi", weekly_periods: 24 });

/** Renders the panel on a client the test can read back, as `renderWithProviders` hides its own. */
function renderWithClient(): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>
        <TeacherLoadPanel sessionId={SESSION_ID} />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
  return queryClient;
}

/** The table row holding `text`. */
function rowOf(text: string): HTMLElement {
  const row = screen.getByText(text).closest("tr");
  if (!row) throw new Error(`No table row holds "${text}"`);
  return row;
}

/** The teacher names down the table, header row excluded. */
function teacherNames() {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell").at(0)?.textContent);
}

describe("TeacherLoadPanel", () => {
  beforeEach(() => {
    mockFetchLoadSummary.mockReset().mockResolvedValue([WITHIN]);
  });

  it("asks for nothing, and shows nothing, without a session", () => {
    const { container } = renderWithProviders(<TeacherLoadPanel sessionId="" />);

    expect(mockFetchLoadSummary).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it("asks for the session's load once, and says it is loading until it arrives", async () => {
    mockFetchLoadSummary.mockReturnValue(new Promise(() => undefined));

    renderWithProviders(<TeacherLoadPanel sessionId={SESSION_ID} />);

    expect(screen.getByRole("heading", { name: "Teacher load" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading the teacher load" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mockFetchLoadSummary).toHaveBeenCalledWith(SESSION_ID);
    });
    expect(mockFetchLoadSummary).toHaveBeenCalledTimes(1);
  });

  it("shows each teacher's allocations, periods and whether they are over the norm", async () => {
    mockFetchLoadSummary.mockResolvedValue([WITHIN, OVER]);

    renderWithProviders(<TeacherLoadPanel sessionId={SESSION_ID} />);

    expect(await screen.findByRole("table", { name: "Teacher load" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    const ayesha = rowOf("Ayesha Khan");
    expect(within(ayesha).getByText("4")).toBeInTheDocument();
    expect(within(ayesha).getByText("18")).toBeInTheDocument();
    expect(within(ayesha).getByText("Within norm")).toBeInTheDocument();
    const bilal = rowOf("Bilal Ahmed");
    expect(within(bilal).getByText("6")).toBeInTheDocument();
    expect(within(bilal).getByText("36")).toBeInTheDocument();
    expect(within(bilal).getByText("Over norm")).toBeInTheDocument();
  });

  it("lists over-norm teachers first, keeping the server's order otherwise", async () => {
    mockFetchLoadSummary.mockResolvedValue([WITHIN, ALSO_WITHIN, OVER]);

    renderWithProviders(<TeacherLoadPanel sessionId={SESSION_ID} />);

    await screen.findByText("Bilal Ahmed");
    expect(teacherNames()).toEqual(["Bilal Ahmed", "Ayesha Khan", "Zainab Bibi"]);
  });

  it("quotes the norm the rows carry, not a fixed one", async () => {
    mockFetchLoadSummary.mockResolvedValue([
      loadRow({ norm: 24 }),
      loadRow({ staff_id: OTHER_STAFF_ID, name: "Bilal Ahmed", norm: 24 }),
    ]);

    renderWithProviders(<TeacherLoadPanel sessionId={SESSION_ID} />);

    expect(
      await screen.findByText(
        "Weekly periods per teacher for the selected session, against a norm of 24.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/norm of 30/)).not.toBeInTheDocument();
  });

  it("says no one carries a load yet, with no norm to quote, when there are no rows", async () => {
    mockFetchLoadSummary.mockResolvedValue([]);

    renderWithProviders(<TeacherLoadPanel sessionId={SESSION_ID} />);

    expect(await screen.findByText("No teaching load in this session")).toBeInTheDocument();
    expect(screen.queryByText(/against a norm of/)).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows a retryable error, not the empty state, when the load can't be fetched", async () => {
    mockFetchLoadSummary.mockRejectedValueOnce(
      new ApiError({
        code: "network_error",
        message: "",
        status: 0,
        url: "/teacher-subject-allocations/load-summary",
      }),
    );
    const user = userEvent.setup();

    renderWithProviders(<TeacherLoadPanel sessionId={SESSION_ID} />);

    expect(await screen.findByText(/we could not reach the server/i)).toBeInTheDocument();
    expect(screen.queryByText("No teaching load in this session")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Ayesha Khan")).toBeInTheDocument();
    expect(mockFetchLoadSummary).toHaveBeenCalledTimes(2);
  });

  it("falls back to its own message for a failure that isn't an API error", async () => {
    mockFetchLoadSummary.mockRejectedValueOnce(new Error("down"));

    renderWithProviders(<TeacherLoadPanel sessionId={SESSION_ID} />);

    expect(await screen.findByText("The teacher load couldn't be loaded.")).toBeInTheDocument();
  });

  // The dashboard's load widget reads this same key, so one cache entry serves both and an
  // allocation write's invalidation of `teacher-allocations` refreshes the widget.
  describe("sharing its cache entry with the dashboard's load widget", () => {
    it("holds the load under the shared key", async () => {
      const queryClient = renderWithClient();

      expect(await screen.findByText("Ayesha Khan")).toBeInTheDocument();
      expect(
        queryClient.getQueryData(
          queryKeys.list("teacher-allocations", "load-summary", { sessionId: SESSION_ID }),
        ),
      ).toEqual([WITHIN]);
    });

    it("asks again when an allocation write invalidates teacher-allocations", async () => {
      const queryClient = renderWithClient();
      expect(await screen.findByText("Ayesha Khan")).toBeInTheDocument();
      mockFetchLoadSummary.mockResolvedValue([WITHIN, OVER]);

      await queryClient.invalidateQueries({ queryKey: queryKeys.module("teacher-allocations") });

      expect(await screen.findByText("Bilal Ahmed")).toBeInTheDocument();
      expect(mockFetchLoadSummary).toHaveBeenCalledTimes(2);
    });
  });
});
