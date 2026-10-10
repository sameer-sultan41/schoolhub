import type { AuthenticatedUser } from "@schoolhub/types";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { Services } from "@/services";
import type { BackgroundJobRecord } from "@/services/modules/jobs/jobs-service";
import { renderWithProviders } from "@/test-utils";

import { StaffToolbar } from "../staff-toolbar";

// `ToolbarHeading` (used inside `StaffToolbar` via `Toolbar`) calls `usePathname()` to
// resolve the page title from `menu-config.ts` — outside a real Next.js App Router tree
// `usePathname()` has no route to read, and `useMenu`'s own `isActive` unconditionally
// calls `pathname.startsWith(...)`, which throws on a nullish pathname. A fixed pathname
// is enough; this test asserts on the stat line, not the resolved title.
jest.mock("next/navigation", () => ({
  usePathname: () => "/staff",
}));

// `StaffFormDialog` renders once "Add Member" is clicked and calls `fetchCampuses`/
// `fetchDepartments`/`fetchDesignations`/`fetchStaffDirectory` from its own gated
// (`enabled: open`) `useQuery` calls — never invoked until the dialog actually opens,
// but the mock object itself needs these four functions present (resolved to empty
// arrays) or the test crashes with "not a function" the moment the dialog opens.
jest.mock("@/services", () => ({
  // The real class: components `instanceof`-check it, and tests build `new ApiError(...)`.
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    auth: { fetchCurrentUser: jest.fn() },
    dashboard: {
      fetchCampuses: jest.fn().mockResolvedValue([]),
      fetchDepartments: jest.fn().mockResolvedValue([]),
      fetchDesignations: jest.fn().mockResolvedValue([]),
    },
    staff: {
      fetchStaffPage: jest.fn(),
      fetchStaffTypeCount: jest.fn(),
      fetchStaffDirectory: jest.fn().mockResolvedValue([]),
      triggerStaffExport: jest.fn(),
      triggerStaffImport: jest.fn(),
    },
    jobs: { fetchJob: jest.fn(), fetchFileDownloadUrl: jest.fn() },
  },
}));

// This file has never needed one before — its own "Add Member" flow shows no
// toasts — but the new export path's failure/timeout/error states surface ONLY as a
// toast, same reasoning as the import dialog's own tests.
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

const mockFetchStaffPage = Services.staff.fetchStaffPage as jest.MockedFunction<
  typeof Services.staff.fetchStaffPage
>;
const mockFetchStaffTypeCount = Services.staff.fetchStaffTypeCount as jest.MockedFunction<
  typeof Services.staff.fetchStaffTypeCount
>;
const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;
const mockTriggerStaffExport = Services.staff.triggerStaffExport as jest.MockedFunction<
  typeof Services.staff.triggerStaffExport
>;
const mockFetchJob = Services.jobs.fetchJob as jest.MockedFunction<typeof Services.jobs.fetchJob>;
const mockFetchFileDownloadUrl = Services.jobs.fetchFileDownloadUrl as jest.MockedFunction<
  typeof Services.jobs.fetchFileDownloadUrl
>;
const mockToastError = toast.error as jest.MockedFunction<typeof toast.error>;

const PERMITTED_USER: AuthenticatedUser = {
  id: "user-1",
  email: "hr@example.com",
  phone: null,
  full_name: "HR Staff",
  avatar_url: null,
  locale: "en",
  tenant_id: "tenant-1",
  roles: [],
  permissions: ["staff.staff.view", "staff.staff.export", "staff.staff.import"],
};

function resolveStatCounts() {
  mockFetchStaffPage.mockResolvedValue({
    items: [],
    pagination: { page: 1, page_size: 1, total_count: 0, total_pages: 0 },
  });
  mockFetchStaffTypeCount.mockResolvedValue(0);
}

function exportJob(
  id: string,
  status: "running" | "succeeded",
  resultFileId?: string,
): BackgroundJobRecord {
  return {
    id,
    job_type: "export.staff",
    status,
    progress: status === "succeeded" ? 100 : 0,
    result: resultFileId ? { result_file_id: resultFileId } : null,
    error: null,
  };
}

async function exportButtonEnabled() {
  const button = await screen.findByRole("button", { name: "Export CSV" });
  await waitFor(() => {
    expect(button).toBeEnabled();
  });
  return button;
}

describe("StaffToolbar", () => {
  beforeEach(() => {
    mockFetchStaffPage.mockReset();
    mockFetchStaffTypeCount.mockReset();
    mockFetchCurrentUser.mockReset().mockResolvedValue(PERMITTED_USER);
    mockTriggerStaffExport.mockReset();
    mockFetchJob.mockReset();
    mockFetchFileDownloadUrl.mockReset();
    mockToastError.mockReset();
  });

  it('shows "—" for both stats while the underlying queries are pending', () => {
    // Never resolves — both queries stay pending for the life of this test, which is
    // exactly the state under assertion.
    mockFetchStaffPage.mockReturnValue(new Promise(() => {}));
    mockFetchStaffTypeCount.mockReturnValue(new Promise(() => {}));

    renderWithProviders(<StaffToolbar />);

    expect(screen.getByText("All Members")).toBeInTheDocument();
    expect(screen.getByText("Teaching Staff")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it('shows "—", never a fabricated "0", when total_count/count are absent from the responses', async () => {
    // A `CursorPagination`-shaped meta (`total_count` optional and, here, omitted) —
    // legitimately "no total is reported here" per that field's own contract, distinct
    // from a reported `0`. `fetchStaffTypeCount` resolving `null` is its own documented
    // "didn't report a total" case (dashboard-service.ts).
    mockFetchStaffPage.mockResolvedValue({
      items: [],
      pagination: { next_cursor: null, previous_cursor: null, page_size: 1 },
    });
    mockFetchStaffTypeCount.mockResolvedValue(null);

    renderWithProviders(<StaffToolbar />);

    await waitFor(() => {
      expect(screen.getAllByText("—")).toHaveLength(2);
    });
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("shows the real numbers once both queries resolve with genuine counts", async () => {
    mockFetchStaffPage.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 1, total_count: 254, total_pages: 254 },
    });
    mockFetchStaffTypeCount.mockResolvedValue(128);

    renderWithProviders(<StaffToolbar />);

    expect(await screen.findByText("254")).toBeInTheDocument();
    expect(screen.getByText("128")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it('"Add Member" opens the staff form dialog in create mode', async () => {
    mockFetchStaffPage.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 1, total_count: 0, total_pages: 0 },
    });
    mockFetchStaffTypeCount.mockResolvedValue(0);

    renderWithProviders(<StaffToolbar />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add Member" }));

    expect(await screen.findByRole("heading", { name: "Add staff member" })).toBeInTheDocument();
  });

  it('"Export CSV" downloads the file once the export job succeeds', async () => {
    mockFetchStaffPage.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 1, total_count: 0, total_pages: 0 },
    });
    mockFetchStaffTypeCount.mockResolvedValue(0);
    mockTriggerStaffExport.mockResolvedValue({ jobId: "job-export-1" });
    mockFetchJob.mockResolvedValue({
      id: "job-export-1",
      job_type: "export.staff",
      status: "succeeded",
      progress: 100,
      result: { result_file_id: "file-1" },
      error: null,
    });
    mockFetchFileDownloadUrl.mockResolvedValue("https://storage.test/staff-export.csv");
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderWithProviders(<StaffToolbar />);
    const user = userEvent.setup();
    await user.click(await exportButtonEnabled());

    await waitFor(() => {
      expect(mockFetchFileDownloadUrl).toHaveBeenCalledWith("file-1");
    });
    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalled();
    });

    clickSpy.mockRestore();
  });

  it('"Export CSV" shows an error toast and re-enables when the download URL fetch fails', async () => {
    mockFetchStaffPage.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 1, total_count: 0, total_pages: 0 },
    });
    mockFetchStaffTypeCount.mockResolvedValue(0);
    mockTriggerStaffExport.mockResolvedValue({ jobId: "job-export-2" });
    mockFetchJob.mockResolvedValue({
      id: "job-export-2",
      job_type: "export.staff",
      status: "succeeded",
      progress: 100,
      result: { result_file_id: "file-2" },
      error: null,
    });
    mockFetchFileDownloadUrl.mockRejectedValue(new Error("storage unavailable"));

    renderWithProviders(<StaffToolbar />);
    const user = userEvent.setup();
    await user.click(await exportButtonEnabled());

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("The export file could not be downloaded.");
    });
    expect(await screen.findByRole("button", { name: "Export CSV" })).not.toBeDisabled();
  });

  it('"Export CSV" shows an error toast when the trigger itself fails', async () => {
    const { ApiError } = jest.requireActual<{ ApiError: new (init: unknown) => Error }>(
      "@schoolhub/api-client",
    );
    mockFetchStaffPage.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 1, total_count: 0, total_pages: 0 },
    });
    mockFetchStaffTypeCount.mockResolvedValue(0);
    mockTriggerStaffExport.mockRejectedValue(
      new ApiError({
        code: "permission_denied",
        message: "You don't have permission to do that.",
        status: 403,
        url: "/staff-exports",
      }),
    );

    renderWithProviders(<StaffToolbar />);
    const user = userEvent.setup();
    await user.click(await exportButtonEnabled());

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("You do not have permission to do that.");
    });
  });

  it("disables both Export CSV and Import CSV for a role without staff.staff.export/.import", async () => {
    mockFetchStaffPage.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 1, total_count: 0, total_pages: 0 },
    });
    mockFetchStaffTypeCount.mockResolvedValue(0);
    const restrictedUser: AuthenticatedUser = {
      id: "user-2",
      email: "admin@example.com",
      phone: null,
      full_name: "School Admin",
      avatar_url: null,
      locale: "en",
      tenant_id: "tenant-1",
      roles: [],
      // school_admin: RECORD_MANAGERS, not STAFF_IO — sees everything else on this
      // screen but not these two.
      permissions: ["staff.staff.view", "staff.staff.create", "staff.staff.update"],
    };
    mockFetchCurrentUser.mockResolvedValue(restrictedUser);

    renderWithProviders(<StaffToolbar />);

    // Waiting for the "no permission" tooltip — not merely for the query to have been
    // *called* — is what actually proves `currentUser` resolved and was read: while
    // still loading, `canExport`/`canImport` are also `false` (an undefined user has
    // no permissions), so a `toBeDisabled()` assertion taken too early would pass
    // regardless of whether the permission check is wired to the right keys at all.
    await screen.findByTitle("You don't have permission to export staff.");
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    expect(screen.getByTitle("You don't have permission to import staff.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import CSV" })).toBeDisabled();
  });

  it("explains the disabled Export/Import buttons while the current user is still loading", () => {
    mockFetchStaffPage.mockReturnValue(new Promise(() => {}));
    mockFetchStaffTypeCount.mockReturnValue(new Promise(() => {}));
    mockFetchCurrentUser.mockReturnValue(new Promise(() => {}));

    renderWithProviders(<StaffToolbar />);

    // Not "you don't have permission" — nothing is known yet to back that claim.
    expect(screen.getAllByTitle("Checking your permissions…")).toHaveLength(2);
    expect(screen.queryByTitle("You don't have permission to export staff.")).toBeNull();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Import CSV" })).toBeDisabled();
  });

  it("still explains the disabled buttons when the current-user lookup fails for good", async () => {
    resolveStatCounts();
    // PERMITTED_USER's own permissions never arrive — exactly the case where a missing
    // title used to leave even a permitted user with a dead, unexplained button.
    mockFetchCurrentUser.mockRejectedValue(new Error("network error"));

    renderWithProviders(<StaffToolbar />);

    const failedTitle = "Your permissions couldn't be loaded. Reload the page to try again.";
    await waitFor(() => {
      expect(screen.getAllByTitle(failedTitle)).toHaveLength(2);
    });
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Import CSV" })).toBeDisabled();
  });

  it("shows no permission title at all once a permitted user has loaded", async () => {
    resolveStatCounts();

    renderWithProviders(<StaffToolbar />);

    await exportButtonEnabled();
    expect(screen.queryByTitle("Checking your permissions…")).toBeNull();
    expect(screen.queryByTitle("You don't have permission to export staff.")).toBeNull();
    expect(screen.queryByTitle("You don't have permission to import staff.")).toBeNull();
  });

  it('"Import CSV" opens the real import dialog for a permitted user', async () => {
    mockFetchStaffPage.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 1, total_count: 0, total_pages: 0 },
    });
    mockFetchStaffTypeCount.mockResolvedValue(0);

    renderWithProviders(<StaffToolbar />);
    const user = userEvent.setup();
    const importButton = await screen.findByRole("button", { name: "Import CSV" });
    await waitFor(() => {
      expect(importButton).toBeEnabled();
    });
    await user.click(importButton);

    // The staff column lists (not another module's) reach the shared dialog.
    const dialog = await screen.findByRole("dialog", { name: "Import staff" });
    expect(within(dialog).getByText("staff_type")).toBeInTheDocument();
    expect(within(dialog).getByText("national_id")).toBeInTheDocument();
  });

  it('"Export CSV" shows a timeout toast when the export job never finishes', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    mockFetchStaffPage.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 1, total_count: 0, total_pages: 0 },
    });
    mockFetchStaffTypeCount.mockResolvedValue(0);
    mockTriggerStaffExport.mockResolvedValue({ jobId: "job-export-3" });
    mockFetchJob.mockResolvedValue({
      id: "job-export-3",
      job_type: "export.staff",
      status: "running",
      progress: 0,
      result: null,
      error: null,
    });

    renderWithProviders(<StaffToolbar />);
    const user = userEvent.setup({ delay: null });
    await user.click(await exportButtonEnabled());

    await jest.advanceTimersByTimeAsync(120_000);

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        "The export is taking longer than expected. Try again in a moment.",
      );
    });
    jest.useRealTimers();
  });

  it('"Export CSV" shows an error toast when the export job itself fails', async () => {
    mockFetchStaffPage.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 1, total_count: 0, total_pages: 0 },
    });
    mockFetchStaffTypeCount.mockResolvedValue(0);
    mockTriggerStaffExport.mockResolvedValue({ jobId: "job-export-4" });
    mockFetchJob.mockResolvedValue({
      id: "job-export-4",
      job_type: "export.staff",
      status: "failed",
      progress: 0,
      result: null,
      error: "Storage backend unavailable.",
    });

    renderWithProviders(<StaffToolbar />);
    const user = userEvent.setup();
    await user.click(await exportButtonEnabled());

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("Storage backend unavailable.");
    });
  });

  it("after a poll timeout, a second click resumes watching the same export job — never a second export that would orphan the first", async () => {
    jest.useFakeTimers({ advanceTimers: true });
    resolveStatCounts();
    mockTriggerStaffExport.mockResolvedValue({ jobId: "job-export-6" });
    mockFetchJob.mockResolvedValue(exportJob("job-export-6", "running"));
    mockFetchFileDownloadUrl.mockResolvedValue("https://storage.test/staff-export.csv");
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderWithProviders(<StaffToolbar />);
    const user = userEvent.setup({ delay: null });
    await user.click(await exportButtonEnabled());

    await jest.advanceTimersByTimeAsync(120_000);
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        "The export is taking longer than expected. Try again in a moment.",
      );
    });

    // The job finishes server-side moments after the UI stopped watching it.
    mockFetchJob.mockResolvedValue(exportJob("job-export-6", "succeeded", "file-6"));
    await user.click(await screen.findByRole("button", { name: "Check export status" }));

    await waitFor(() => {
      expect(mockFetchFileDownloadUrl).toHaveBeenCalledWith("file-6");
    });
    expect(mockTriggerStaffExport).toHaveBeenCalledTimes(1);
    expect(mockFetchJob).toHaveBeenLastCalledWith("job-export-6");

    clickSpy.mockRestore();
    jest.useRealTimers();
  });

  it("after a failed poll, a second click re-checks the same export job instead of starting another", async () => {
    const { ApiError } = jest.requireActual<{ ApiError: new (init: unknown) => Error }>(
      "@schoolhub/api-client",
    );
    resolveStatCounts();
    mockTriggerStaffExport.mockResolvedValue({ jobId: "job-export-7" });
    mockFetchJob
      // Status 0 is a transient network failure, so the job stays resumable (a 404/403 drops it).
      .mockRejectedValueOnce(new ApiError({ code: "network_error", message: "x", status: 0 }))
      .mockResolvedValue(exportJob("job-export-7", "succeeded", "file-7"));
    mockFetchFileDownloadUrl.mockResolvedValue("https://storage.test/staff-export.csv");
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderWithProviders(<StaffToolbar />);
    const user = userEvent.setup();
    await user.click(await exportButtonEnabled());

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("The export failed.");
    });
    await user.click(await screen.findByRole("button", { name: "Check export status" }));

    await waitFor(() => {
      expect(mockFetchFileDownloadUrl).toHaveBeenCalledWith("file-7");
    });
    expect(mockTriggerStaffExport).toHaveBeenCalledTimes(1);

    clickSpy.mockRestore();
  });

  it('"Export CSV" shows an error toast when the poll request itself fails', async () => {
    mockFetchStaffPage.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 1, total_count: 0, total_pages: 0 },
    });
    mockFetchStaffTypeCount.mockResolvedValue(0);
    mockTriggerStaffExport.mockResolvedValue({ jobId: "job-export-5" });
    mockFetchJob.mockRejectedValue(new Error("network error"));

    renderWithProviders(<StaffToolbar />);
    const user = userEvent.setup();
    await user.click(await exportButtonEnabled());

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("The export failed.");
    });
  });
});
