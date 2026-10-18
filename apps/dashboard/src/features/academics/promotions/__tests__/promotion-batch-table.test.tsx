import { ApiError } from "@schoolhub/api-client";
import type { AuthenticatedUser, PermissionKey } from "@schoolhub/types";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import {
  BATCH_ID,
  NEXT_CLASS_ID,
  OTHER_BATCH_ID,
  promotionBatch,
  promotionBatchPage,
} from "@/services/modules/promotions/__tests__/promotions-fixtures";
import { CLASS_ID, PLANNED_SESSION_ID, SESSION_ID, SESSIONS } from "@/test-fixtures/academics";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { PromotionBatchTable } from "../promotion-batch-table";
import { PromotionBatchToolbar } from "../promotion-batch-toolbar";

// The list's view state lives in the URL, which the navigation mock keeps in memory; the router
// is this file's own so a row click can be asserted.
const mockPush = jest.fn();
const mockRouter = { push: mockPush };
jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => object }>("@/test-utils");
  return { ...testUtils.createNavigationMock(), useRouter: () => mockRouter };
});

// Creating a batch toasts, and `renderWithProviders` mounts no `<Toaster/>`.
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

// The toolbar and the filters each fire their own queries the instant they render, and the
// create dialog its own when it opens: every Service they call needs a default.
jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    auth: { fetchCurrentUser: jest.fn() },
    promotions: { fetchPromotionBatches: jest.fn(), createPromotionBatch: jest.fn() },
    schoolOrganization: { fetchAcademicSessions: jest.fn(), fetchClasses: jest.fn() },
  },
}));

const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;
const mockFetchBatches = Services.promotions.fetchPromotionBatches as jest.MockedFunction<
  typeof Services.promotions.fetchPromotionBatches
>;
const mockFetchSessions = Services.schoolOrganization.fetchAcademicSessions as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchAcademicSessions
>;
const mockFetchClasses = Services.schoolOrganization.fetchClasses as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchClasses
>;

/** What the list requests with nothing in the URL: the first page, in the API's own order
 * (newest batch first), every status, session and class. */
const DEFAULT_REQUEST = {
  page: 1,
  pageSize: 10,
  ordering: undefined,
  status: undefined,
  fromAcademicSessionId: undefined,
  fromClassId: undefined,
};

const GRADE_ONE_LINK = "Grade 1, 2026-27 → 2027-28";

/** A viewer of the screen, plus whatever else a test grants. */
function userWith(...permissions: PermissionKey[]): AuthenticatedUser {
  return buildUser(["academics.promotion.view", ...permissions]);
}

/** What DRF's page-number pagination answers for a page past the end. */
function pageNotFound() {
  return new ApiError({
    code: "not_found",
    message: "Invalid page.",
    status: 404,
    url: "/student-promotions",
  });
}

/** The address bar's current query, as key/value pairs. */
function urlParams() {
  return Object.fromEntries(new URLSearchParams(window.location.search));
}

/** The table row holding the link called `name`. */
function rowOf(name: string): HTMLElement {
  const row = screen.getByRole("link", { name }).closest("tr");
  if (!row) throw new Error(`No table row holds the link "${name}"`);
  return row;
}

/** The screen as the page composes it: the toolbar above the table. */
function renderScreen() {
  return renderWithProviders(
    <>
      <PromotionBatchToolbar />
      <PromotionBatchTable />
    </>,
  );
}

describe("PromotionBatchTable", () => {
  beforeEach(() => {
    setUrl("/academics/promotions");
    mockPush.mockReset();
    mockFetchCurrentUser.mockReset().mockResolvedValue(userWith("academics.promotion.create"));
    mockFetchSessions.mockReset().mockResolvedValue(SESSIONS);
    mockFetchBatches.mockReset().mockResolvedValue(promotionBatchPage([promotionBatch()]));
    mockFetchClasses.mockReset().mockResolvedValue([
      { id: CLASS_ID, name: "Grade 1" },
      { id: NEXT_CLASS_ID, name: "Grade 2" },
    ]);
  });

  describe("rows", () => {
    it("shows each batch's class, sessions, students, status and when it started", async () => {
      mockFetchBatches.mockResolvedValue(
        promotionBatchPage([
          promotionBatch(),
          promotionBatch({
            batch_id: OTHER_BATCH_ID,
            from_class_id: NEXT_CLASS_ID,
            from_class_name: "Grade 2",
            status: "executed",
            students: 1200,
          }),
        ]),
      );

      renderScreen();

      expect(await screen.findByRole("link", { name: GRADE_ONE_LINK })).toBeInTheDocument();
      const draft = rowOf(GRADE_ONE_LINK);
      expect(within(draft).getByText("Grade 1")).toBeInTheDocument();
      expect(within(draft).getByText("2026-27 → 2027-28")).toBeInTheDocument();
      expect(within(draft).getByText("24")).toBeInTheDocument();
      expect(within(draft).getByText("Draft")).toBeInTheDocument();

      const executed = rowOf("Grade 2, 2026-27 → 2027-28");
      expect(within(executed).getByText("Executed")).toBeInTheDocument();
      expect(within(executed).getByText("1,200")).toBeInTheDocument();
      expect(within(executed).queryByText("Draft")).not.toBeInTheDocument();
    });

    it("shows a partly executed batch as two rows, with no duplicate key", async () => {
      const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
      mockFetchBatches.mockResolvedValue(
        promotionBatchPage([
          promotionBatch({ status: "executed", students: 3 }),
          promotionBatch({ status: "approved", students: 2 }),
        ]),
      );

      try {
        renderScreen();

        expect(await screen.findAllByRole("link", { name: GRADE_ONE_LINK })).toHaveLength(2);
        expect(screen.getByText("Executed")).toBeInTheDocument();
        expect(screen.getByText("Approved")).toBeInTheDocument();
        const duplicateKey = consoleError.mock.calls.some(([message]) =>
          String(message).includes("same key"),
        );
        expect(duplicateKey).toBe(false);
      } finally {
        consoleError.mockRestore();
      }
    });

    it("shows when a batch started as relative time, not the raw timestamp", async () => {
      renderScreen();

      // "… ago", or "in …" on a runner whose clock is behind the fixture.
      const started = await screen.findByText(/^(in .+|.+ ago)$/);
      expect(started).toHaveAttribute("datetime", "2026-09-01T12:00:00Z");
      expect(started).toHaveAttribute("title", expect.stringContaining("2026"));
      expect(screen.queryByText("2026-09-01T12:00:00Z")).not.toBeInTheDocument();
    });

    it("names the table and the screen", async () => {
      renderScreen();

      expect(await screen.findByRole("table", { name: "Promotion batches" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Promotions" })).toBeInTheDocument();
    });

    it("offers a sort on status, students and started, and on no other column", async () => {
      renderScreen();

      await screen.findByRole("link", { name: GRADE_ONE_LINK });
      expect(screen.getByRole("button", { name: "Status" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Students" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Started" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "From class" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Sessions" })).not.toBeInTheDocument();
    });

    it("says no batch exists yet when there are no rows and no filter", async () => {
      mockFetchBatches.mockResolvedValue(promotionBatchPage([]));

      renderScreen();

      expect(await screen.findByText("No promotion batches yet")).toBeInTheDocument();
      expect(
        screen.queryByText("No promotion batches match these filters"),
      ).not.toBeInTheDocument();
    });

    it("says no batch matches once a filter is applied", async () => {
      mockFetchBatches.mockResolvedValue(promotionBatchPage([]));
      setUrl("/academics/promotions?status=reverted");

      renderScreen();

      expect(
        await screen.findByText("No promotion batches match these filters"),
      ).toBeInTheDocument();
      expect(screen.queryByText("No promotion batches yet")).not.toBeInTheDocument();
    });

    it("shows a retryable error, with the API's own reason, when the list can't load", async () => {
      mockFetchBatches.mockRejectedValueOnce(
        new ApiError({ code: "network_error", message: "", status: 0, url: "/student-promotions" }),
      );
      const user = userEvent.setup();

      renderScreen();

      expect(await screen.findByText(/we could not reach the server/i)).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Try again" }));

      expect(await screen.findByRole("link", { name: GRADE_ONE_LINK })).toBeInTheDocument();
      expect(mockFetchBatches).toHaveBeenCalledTimes(2);
    });

    it("falls back to its own message for a failure that isn't an API error", async () => {
      mockFetchBatches.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      renderScreen();

      expect(
        await screen.findByText("The promotion batches couldn't be loaded."),
      ).toBeInTheDocument();
    });
  });

  describe("opening a batch", () => {
    it("links each row to its own batch page, named by class and sessions", async () => {
      mockFetchBatches.mockResolvedValue(
        promotionBatchPage([
          promotionBatch(),
          promotionBatch({
            batch_id: OTHER_BATCH_ID,
            from_academic_session_name: "2025-26",
            to_academic_session_name: "2026-27",
          }),
        ]),
      );

      renderScreen();

      // The same class in two rollovers: the link names tell them apart.
      const current = await screen.findByRole("link", { name: GRADE_ONE_LINK });
      expect(current).toHaveAttribute("href", `/academics/promotions/${BATCH_ID}`);
      const earlier = screen.getByRole("link", { name: "Grade 1, 2025-26 → 2026-27" });
      expect(earlier).toHaveAttribute("href", `/academics/promotions/${OTHER_BATCH_ID}`);
    });

    it("opens the batch when anywhere else on its row is clicked", async () => {
      const user = userEvent.setup();

      renderScreen();

      await screen.findByRole("link", { name: GRADE_ONE_LINK });
      await user.click(within(rowOf(GRADE_ONE_LINK)).getByText("24"));

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith(`/academics/promotions/${BATCH_ID}`);
    });

    it("keeps the batch link even when a shared URL hides its column", async () => {
      setUrl("/academics/promotions?hidden=fromClass,students");

      renderScreen();

      expect(await screen.findByRole("link", { name: GRADE_ONE_LINK })).toBeInTheDocument();
      // Students is hideable, so the same URL does hide it.
      expect(screen.queryByRole("button", { name: "Students" })).not.toBeInTheDocument();
      expect(screen.getByText("2026-27 → 2027-28")).toBeInTheDocument();
    });
  });

  describe("the URL", () => {
    it("asks for the newest batches, with no ordering, when the URL names nothing", async () => {
      renderScreen();

      expect(await screen.findByRole("link", { name: GRADE_ONE_LINK })).toBeInTheDocument();
      expect(mockFetchBatches.mock.calls).toEqual([[DEFAULT_REQUEST]]);
    });

    it("opens a deep link with its status and sort, and asks for exactly that", async () => {
      setUrl("/academics/promotions?status=pending_approval&sort=-students");
      mockFetchBatches.mockResolvedValue(
        promotionBatchPage([promotionBatch({ status: "pending_approval", students: 40 })]),
      );

      renderScreen();

      expect(await screen.findByRole("link", { name: GRADE_ONE_LINK })).toBeInTheDocument();
      expect(mockFetchBatches.mock.calls).toEqual([
        [{ ...DEFAULT_REQUEST, status: "pending_approval", ordering: "-students" }],
      ]);
      await waitFor(() => {
        expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent(
          "Pending approval",
        );
      });
      expect(urlParams()).toEqual({ status: "pending_approval", sort: "-students" });
    });

    it("opens a shared link with its session, class, status, sort and page", async () => {
      setUrl(
        `/academics/promotions?session=${PLANNED_SESSION_ID}&class=${CLASS_ID}` +
          "&status=executed&sort=-startedAt&page=2",
      );
      mockFetchBatches.mockResolvedValue(
        promotionBatchPage([promotionBatch()], { page: 2, totalPages: 3 }),
      );

      renderScreen();

      await waitFor(() => {
        expect(mockFetchBatches).toHaveBeenCalledWith({
          ...DEFAULT_REQUEST,
          page: 2,
          ordering: "-started_at",
          status: "executed",
          fromAcademicSessionId: PLANNED_SESSION_ID,
          fromClassId: CLASS_ID,
        });
      });
      expect(await screen.findByRole("link", { name: GRADE_ONE_LINK })).toBeInTheDocument();
      expect(urlParams()).toEqual({
        session: PLANNED_SESSION_ID,
        class: CLASS_ID,
        status: "executed",
        sort: "-startedAt",
        page: "2",
      });
    });

    it("ignores a status, ids and sort that no list accepts", async () => {
      setUrl("/academics/promotions?status=done&session=current&class=grade-1&sort=-name");

      renderScreen();

      expect(await screen.findByRole("link", { name: GRADE_ONE_LINK })).toBeInTheDocument();
      expect(mockFetchBatches.mock.calls).toEqual([[DEFAULT_REQUEST]]);
    });

    it("lands on page 1 when a linked page no longer exists", async () => {
      setUrl("/academics/promotions?page=9");
      mockFetchBatches.mockImplementation((query) =>
        query.page === 9
          ? Promise.reject(pageNotFound())
          : Promise.resolve(promotionBatchPage([promotionBatch()])),
      );

      renderScreen();

      await waitFor(() => {
        expect(mockFetchBatches).toHaveBeenLastCalledWith(DEFAULT_REQUEST);
      });
      expect(mockFetchBatches).toHaveBeenCalledWith({ ...DEFAULT_REQUEST, page: 9 });
      expect(urlParams()).toEqual({});
      expect(await screen.findByRole("link", { name: GRADE_ONE_LINK })).toBeInTheDocument();
      expect(screen.queryByText(/couldn't be loaded/)).not.toBeInTheDocument();
    });

    it("steps back to the last page when the list has shrunk under a linked page", async () => {
      setUrl("/academics/promotions?page=3");
      mockFetchBatches.mockImplementation((query) =>
        Promise.resolve(
          promotionBatchPage([promotionBatch()], { page: query.page, totalPages: 2 }),
        ),
      );

      renderScreen();

      await waitFor(() => {
        expect(urlParams()).toEqual({ page: "2" });
      });
    });
  });

  describe("filters", () => {
    it("writes a status filter to the URL, dropping the page, and asks for it", async () => {
      setUrl("/academics/promotions?page=2");
      mockFetchBatches.mockImplementation((query) =>
        Promise.resolve(
          promotionBatchPage([promotionBatch()], { page: query.page, totalPages: 3 }),
        ),
      );
      const user = userEvent.setup();

      renderScreen();

      await user.click(await screen.findByRole("combobox", { name: "Status" }));
      await user.click(await screen.findByRole("option", { name: "Draft" }));

      expect(urlParams()).toEqual({ status: "draft" });
      await waitFor(() => {
        expect(mockFetchBatches).toHaveBeenLastCalledWith({ ...DEFAULT_REQUEST, status: "draft" });
      });
      // The page was dropped by the filter, not asked for first.
      expect(mockFetchBatches).not.toHaveBeenCalledWith(
        expect.objectContaining({ page: 2, status: "draft" }),
      );
    });

    it("offers every status, in the order a batch moves through them", async () => {
      const user = userEvent.setup();

      renderScreen();

      await user.click(await screen.findByRole("combobox", { name: "Status" }));

      const options = await screen.findAllByRole("option");
      expect(options.map((option) => option.textContent)).toEqual([
        "All",
        "Draft",
        "Pending approval",
        "Approved",
        "Executed",
        "Reverted",
      ]);
    });

    it("filters by the session a batch moves from, the current session included", async () => {
      const user = userEvent.setup();

      renderScreen();

      await user.click(await screen.findByRole("combobox", { name: "From session" }));
      await user.click(await screen.findByRole("option", { name: "2026-27" }));

      // Not the empty "current session" of the session-scoped screens: this list's empty
      // session means all of them.
      expect(urlParams()).toEqual({ session: SESSION_ID });
      await waitFor(() => {
        expect(mockFetchBatches).toHaveBeenLastCalledWith({
          ...DEFAULT_REQUEST,
          fromAcademicSessionId: SESSION_ID,
        });
      });
    });

    it("filters by the class a batch moves", async () => {
      const user = userEvent.setup();

      renderScreen();

      await user.click(await screen.findByRole("combobox", { name: "From class" }));
      await user.click(await screen.findByRole("option", { name: "Grade 2" }));

      expect(urlParams()).toEqual({ class: NEXT_CLASS_ID });
      await waitFor(() => {
        expect(mockFetchBatches).toHaveBeenLastCalledWith({
          ...DEFAULT_REQUEST,
          fromClassId: NEXT_CLASS_ID,
        });
      });
    });

    it("goes back to every status when All is chosen, leaving the URL", async () => {
      setUrl("/academics/promotions?status=approved");
      const user = userEvent.setup();

      renderScreen();

      await user.click(await screen.findByRole("combobox", { name: "Status" }));
      await user.click(await screen.findByRole("option", { name: "All" }));

      expect(urlParams()).toEqual({});
      await waitFor(() => {
        expect(mockFetchBatches).toHaveBeenLastCalledWith(DEFAULT_REQUEST);
      });
    });
  });

  describe("New batch", () => {
    it("is offered, once the permissions load, to a viewer with promotion.create", async () => {
      renderScreen();

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "New batch" })).toBeEnabled();
      });
    });

    it("is hidden from a viewer without promotion.create", async () => {
      mockFetchCurrentUser.mockResolvedValue(userWith("academics.promotion.update"));

      renderScreen();

      // Shown (disabled) until the permissions load, so its absence means they have.
      expect(screen.getByRole("button", { name: "New batch" })).toBeDisabled();
      await waitFor(() => {
        expect(screen.queryByRole("button", { name: "New batch" })).not.toBeInTheDocument();
      });
      expect(await screen.findByRole("link", { name: GRADE_ONE_LINK })).toBeInTheDocument();
    });

    it("stays disabled, and says why, until the viewer's permissions are known", async () => {
      mockFetchCurrentUser.mockReturnValue(new Promise<AuthenticatedUser>(() => undefined));

      renderScreen();

      expect(await screen.findByRole("link", { name: GRADE_ONE_LINK })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "New batch" })).toBeDisabled();
      expect(screen.getByTitle("Checking your permissions…")).toBeInTheDocument();
    });

    it("says why it is disabled when the viewer's permissions can't load", async () => {
      mockFetchCurrentUser.mockRejectedValue(new Error("down"));

      renderScreen();

      expect(
        await screen.findByTitle(
          "Your permissions couldn't be loaded. Reload the page to try again.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "New batch" })).toBeDisabled();
    });

    it("stays disabled until the sessions it offers have loaded", async () => {
      let resolveSessions: (sessions: typeof SESSIONS) => void = () => undefined;
      mockFetchSessions.mockReturnValue(
        new Promise<typeof SESSIONS>((resolve) => {
          resolveSessions = resolve;
        }),
      );

      renderScreen();

      expect(await screen.findByRole("link", { name: GRADE_ONE_LINK })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "New batch" })).toBeDisabled();

      resolveSessions(SESSIONS);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "New batch" })).toBeEnabled();
      });
    });

    it("says why it is disabled when the sessions can't load", async () => {
      mockFetchSessions.mockRejectedValue(new Error("down"));

      renderScreen();

      const reason =
        "The academic sessions couldn't be loaded, so a batch can't be created. " +
        "Reload the page to try again.";
      expect(await screen.findByTitle(reason)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "New batch" })).toBeDisabled();
    });

    it("opens the create form on the current session", async () => {
      const user = userEvent.setup();

      renderScreen();

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "New batch" })).toBeEnabled();
      });
      await user.click(screen.getByRole("button", { name: "New batch" }));

      const dialog = await screen.findByRole("dialog", { name: "New promotion batch" });
      // The filter bar has a control of the same name, so look inside the dialog.
      const fromSession = within(dialog).getByRole("combobox", { name: "From session" });
      await waitFor(() => {
        expect(fromSession).toHaveTextContent("2026-27");
      });
    });
  });
});
