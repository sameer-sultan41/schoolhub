import { ApiError } from "@schoolhub/api-client";
import type { AuthenticatedUser } from "@schoolhub/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { toast } from "sonner";
import type { ReactNode } from "react";

import { Services } from "@/services";
import type { BackgroundJobRecord } from "@/services/modules/jobs/jobs-service";
import { renderWithProviders } from "@/test-utils";
import messages from "../../../../../messages/en.json";

import { StaffImportDialog } from "../staff-import-dialog";

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    auth: { fetchCurrentUser: jest.fn() },
    staff: { triggerStaffImport: jest.fn() },
    jobs: { fetchJob: jest.fn() },
  },
}));

// Same pattern exit-staff-dialog.test.tsx already uses: `renderWithProviders` mounts
// no `<Toaster/>`, so a real (unmocked) `sonner` call reaches no DOM node a test could
// assert on — several of this file's own paths (a poll error, a timeout, the
// synchronous size-cap rejection) surface ONLY as a toast, with no inline element.
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

const mockTriggerStaffImport = Services.staff.triggerStaffImport as jest.MockedFunction<
  typeof Services.staff.triggerStaffImport
>;
const mockFetchJob = Services.jobs.fetchJob as jest.MockedFunction<typeof Services.jobs.fetchJob>;
const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;
const mockToastError = toast.error as jest.MockedFunction<typeof toast.error>;

const HR_USER: AuthenticatedUser = {
  id: "user-1",
  email: "hr@example.com",
  phone: null,
  full_name: "HR Staff",
  avatar_url: null,
  locale: "en",
  tenant_id: "tenant-1",
  roles: [],
  permissions: ["staff.staff.view", "staff.staff.import"],
};

function csvFile() {
  return new File(["first_name,last_name"], "staff.csv", { type: "text/csv" });
}

function importJob(
  id: string,
  status: "running" | "succeeded",
  progress = 40,
): BackgroundJobRecord {
  return {
    id,
    job_type: "import.staff",
    status,
    progress: status === "succeeded" ? 100 : progress,
    result: status === "succeeded" ? { total: 1, succeeded: 1, failed: 0, errors: [] } : null,
    error: null,
  };
}

/** One QueryClient for the whole test, re-applied on every `rerender` — see the note in
 * "stops polling once the dialog is closed mid-import" below. */
function stableProviders() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Providers({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale="en" messages={messages}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </NextIntlClientProvider>
    );
  };
}

async function uploadCsv(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText("File"), csvFile());
  await user.click(screen.getByRole("button", { name: "Upload" }));
}

describe("StaffImportDialog", () => {
  beforeEach(() => {
    mockTriggerStaffImport.mockReset();
    mockFetchJob.mockReset();
    mockFetchCurrentUser.mockReset().mockResolvedValue(HR_USER);
    mockToastError.mockReset();
    window.sessionStorage.clear();
  });

  it("renders nothing (no dialog role) when closed", () => {
    renderWithProviders(<StaffImportDialog open={false} onOpenChange={jest.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the required/optional column hint before any file is picked", () => {
    renderWithProviders(<StaffImportDialog open onOpenChange={jest.fn()} />);
    expect(screen.getByText("campus_code")).toBeInTheDocument();
    expect(screen.getByText("national_id")).toBeInTheDocument();
  });

  it("shows a per-row failure table when the import partially succeeds", async () => {
    mockTriggerStaffImport.mockResolvedValue({ jobId: "job-import-1" });
    mockFetchJob.mockResolvedValue({
      id: "job-import-1",
      job_type: "import.staff",
      status: "succeeded",
      progress: 100,
      result: {
        total: 2,
        succeeded: 1,
        failed: 1,
        // A string, as the backend really sends it (`str(row_number)`).
        errors: [{ row: "3", field: "campus_code", issue: "Unknown campus code 'ZZZ'." }],
      },
      error: null,
    });

    renderWithProviders(<StaffImportDialog open onOpenChange={jest.fn()} />);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("File"), csvFile());
    await user.click(screen.getByRole("button", { name: "Upload" }));

    // Scoped to the error table specifically: "campus_code" also appears in the
    // always-rendered required/optional columns hint above the file input, so an
    // unscoped `getByText("campus_code")` would throw "found multiple elements" the
    // instant this table renders alongside it.
    const table = within(await screen.findByRole("table"));
    expect(table.getByText("3")).toBeInTheDocument();
    expect(table.getByText("campus_code")).toBeInTheDocument();
    expect(table.getByText("Unknown campus code 'ZZZ'.")).toBeInTheDocument();
    expect(screen.getByText("1 imported")).toBeInTheDocument();
    expect(screen.getByText("1 failed")).toBeInTheDocument();
  });

  it("shows the server's real per-field validation message when the import file is rejected synchronously (over the size cap)", async () => {
    const { ApiError } = jest.requireActual<{ ApiError: new (init: unknown) => Error }>(
      "@schoolhub/api-client",
    );
    // `DomainRuleViolation` (`apps/api/core/api/exceptions.py`'s `default_code =
    // "domain_rule_violation"`) is the REAL code the size-cap check in
    // `StaffImportViewSet.create` raises (`viewset.py:236-239`) — not
    // `validation_error`. Its mapped `errors.domain_rule_violation` message
    // ("That action isn't allowed right now.") is generic on purpose (the code
    // covers many unrelated business rules); the actually-useful text is the
    // field-level `details` entry, which is exactly what `ApiError.fieldErrors()`
    // surfaces and what the component below must prefer.
    mockTriggerStaffImport.mockRejectedValue(
      new ApiError({
        code: "domain_rule_violation",
        message: "Import file exceeds the 5242880-byte limit.",
        status: 422,
        url: "/staff-imports",
        details: [
          {
            field: "file",
            issue: "Import file exceeds the 5242880-byte limit.",
            code: "domain_rule_violation",
          },
        ],
      }),
    );

    renderWithProviders(<StaffImportDialog open onOpenChange={jest.fn()} />);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("File"), csvFile());
    await user.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("Import file exceeds the 5242880-byte limit.");
    });
  });

  it("shows the job's own raw failure message when the file parses but the job itself fails asynchronously", async () => {
    mockTriggerStaffImport.mockResolvedValue({ jobId: "job-import-2" });
    mockFetchJob.mockResolvedValue({
      id: "job-import-2",
      job_type: "import.staff",
      status: "failed",
      progress: 0,
      result: null,
      error: "Unsupported xlsx format.",
    });

    renderWithProviders(<StaffImportDialog open onOpenChange={jest.fn()} />);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("File"), csvFile());
    await user.click(screen.getByRole("button", { name: "Upload" }));

    // Rendered inline (an `Alert`), unlike the synchronous case above — this one
    // reads real DOM text, not a toast call.
    expect(await screen.findByText("Unsupported xlsx format.")).toBeInTheDocument();
  });

  it("shows an error toast when the poll request itself fails, and keeps the file input locked so a re-upload can't create duplicates", async () => {
    mockTriggerStaffImport.mockResolvedValue({ jobId: "job-import-4" });
    // Status 0 is what the api-client makes of a network failure — transient, so the
    // job is still one worth reconnecting to (unlike a refused 404, tested below).
    mockFetchJob.mockRejectedValue(
      new ApiError({
        code: "network_error",
        message: "Network request failed.",
        status: 0,
        url: "/jobs/job-import-4",
      }),
    );

    renderWithProviders(<StaffImportDialog open onOpenChange={jest.fn()} />);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("File"), csvFile());
    await user.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("The import failed.");
    });
    // The job's own status is unknown (the poll itself failed, not the job), so this
    // must not look like an idle dialog ready for a fresh file — the "Upload" button
    // shouldn't even be offered, and the footer reads "Run in background" (distinct
    // from the dialog's own built-in X button, also named "Close") since there is
    // nothing left to cancel.
    expect(screen.getByLabelText("File")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Upload" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run in background" })).toBeInTheDocument();
  });

  it("shows a timeout toast when the job never reaches a terminal status, and keeps the file input locked", async () => {
    jest.useFakeTimers({ advanceTimers: true });
    mockTriggerStaffImport.mockResolvedValue({ jobId: "job-import-5" });
    mockFetchJob.mockResolvedValue({
      id: "job-import-5",
      job_type: "import.staff",
      status: "running",
      progress: 10,
      result: null,
      error: null,
    });

    renderWithProviders(<StaffImportDialog open onOpenChange={jest.fn()} />);
    const user = userEvent.setup({ delay: null });
    await user.upload(screen.getByLabelText("File"), csvFile());
    await user.click(screen.getByRole("button", { name: "Upload" }));

    await jest.advanceTimersByTimeAsync(120_000);

    const timedOutMessage = "Still running in the background — check back shortly.";
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(timedOutMessage);
    });
    // The import may well still be running server-side — re-enabling the file picker
    // here would invite a second, duplicate import of the same rows.
    expect(screen.getByLabelText("File")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Upload" })).not.toBeInTheDocument();
    expect(screen.getByText(timedOutMessage)).toBeInTheDocument();
    jest.useRealTimers();
  });

  it("invalidates the staff and dashboard queries once the import succeeds with at least one imported row", async () => {
    mockTriggerStaffImport.mockResolvedValue({ jobId: "job-import-6" });
    mockFetchJob.mockResolvedValue({
      id: "job-import-6",
      job_type: "import.staff",
      status: "succeeded",
      progress: 100,
      result: { total: 1, succeeded: 1, failed: 0, errors: [] },
      error: null,
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <NextIntlClientProvider locale="en" messages={messages}>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </NextIntlClientProvider>
      );
    }

    render(<StaffImportDialog open onOpenChange={jest.fn()} />, { wrapper: Wrapper });
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("File"), csvFile());
    await user.click(screen.getByRole("button", { name: "Upload" }));

    await screen.findByText("1 imported");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["staff"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["dashboard"] });
  });

  it("stops polling once the dialog is closed mid-import", async () => {
    jest.useFakeTimers({ advanceTimers: true });
    mockTriggerStaffImport.mockResolvedValue({ jobId: "job-import-3" });
    mockFetchJob.mockResolvedValue({
      id: "job-import-3",
      job_type: "import.staff",
      status: "running",
      progress: 0,
      result: null,
      error: null,
    });

    const onOpenChange = jest.fn();
    // A local `wrapper` (RTL's own option, not `renderWithProviders`) is what makes
    // `rerender` re-apply the providers on every call — `renderWithProviders` returns
    // a plain `render()` result whose `rerender` swaps the ENTIRE tree for whatever
    // element it's given, providers included, so `rerender(<Wrapper open={false} />)`
    // without this option would silently drop the `QueryClientProvider`/
    // `NextIntlClientProvider` and throw the moment `useTranslations`/`useQuery` ran
    // again. Mirrors `staff-form-dialog.test.tsx`'s own identical regression test.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <NextIntlClientProvider locale="en" messages={messages}>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </NextIntlClientProvider>
      );
    }

    const { rerender } = render(<StaffImportDialog open onOpenChange={onOpenChange} />, {
      wrapper: Wrapper,
    });
    const user = userEvent.setup({ delay: null });
    await user.upload(screen.getByLabelText("File"), csvFile());
    await user.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => {
      expect(mockFetchJob).toHaveBeenCalledTimes(1);
    });

    // Control: still open, still polling — a second poll fires after one more
    // interval, proving the fake-timer setup actually drives this query.
    await jest.advanceTimersByTimeAsync(2000);
    await waitFor(() => {
      expect(mockFetchJob).toHaveBeenCalledTimes(2);
    });

    rerender(<StaffImportDialog open={false} onOpenChange={onOpenChange} />);

    const callsAtClose = mockFetchJob.mock.calls.length;
    await jest.advanceTimersByTimeAsync(10_000);
    expect(mockFetchJob.mock.calls.length).toBe(callsAtClose);
    jest.useRealTimers();
  });

  it("can't be closed while the upload is still in flight — Escape does nothing and the X is hidden", async () => {
    let resolveUpload: (value: { jobId: string }) => void = () => {};
    mockTriggerStaffImport.mockReturnValue(
      new Promise<{ jobId: string }>((resolve) => {
        resolveUpload = resolve;
      }),
    );
    mockFetchJob.mockResolvedValue(importJob("job-import-7", "running"));
    const onOpenChange = jest.fn();

    renderWithProviders(<StaffImportDialog open onOpenChange={onOpenChange} />);
    const user = userEvent.setup();
    await uploadCsv(user);

    // Aborting the request couldn't stop a job the server may already have created, so
    // no close path is offered until it answers.
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(onOpenChange).not.toHaveBeenCalled();

    // The job the server created shows up in the dialog the user never left.
    resolveUpload({ jobId: "job-import-7" });
    expect(await screen.findByText("Importing — 40%")).toBeInTheDocument();
    expect(mockFetchJob).toHaveBeenCalledWith("job-import-7");
  });

  it('"Run in background" keeps the job: reopening the dialog reconnects to it instead of a blank slate', async () => {
    mockTriggerStaffImport.mockResolvedValue({ jobId: "job-import-8" });
    mockFetchJob.mockResolvedValue(importJob("job-import-8", "running"));
    const onOpenChange = jest.fn();

    const { rerender } = render(<StaffImportDialog open onOpenChange={onOpenChange} />, {
      wrapper: stableProviders(),
    });
    const user = userEvent.setup();
    await uploadCsv(user);
    await screen.findByText("Importing — 40%");

    await user.click(screen.getByRole("button", { name: "Run in background" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    rerender(<StaffImportDialog open={false} onOpenChange={onOpenChange} />);
    const callsWhileClosed = mockFetchJob.mock.calls.length;

    mockFetchJob.mockResolvedValue(importJob("job-import-8", "running", 70));
    rerender(<StaffImportDialog open onOpenChange={onOpenChange} />);

    expect(await screen.findByText("Importing — 70%")).toBeInTheDocument();
    expect(mockFetchJob.mock.calls.length).toBeGreaterThan(callsWhileClosed);
    expect(screen.getByLabelText("File")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Upload" })).not.toBeInTheDocument();
  });

  it("reconnects to a background import after the dialog remounts, e.g. navigating away and back", async () => {
    mockTriggerStaffImport.mockResolvedValue({ jobId: "job-import-9" });
    mockFetchJob.mockResolvedValue(importJob("job-import-9", "running"));

    const first = renderWithProviders(<StaffImportDialog open onOpenChange={jest.fn()} />);
    const user = userEvent.setup();
    await uploadCsv(user);
    await screen.findByText("Importing — 40%");
    await user.click(screen.getByRole("button", { name: "Run in background" }));
    first.unmount();

    // It finished while the user was elsewhere.
    mockFetchJob.mockResolvedValue(importJob("job-import-9", "succeeded"));
    renderWithProviders(<StaffImportDialog open onOpenChange={jest.fn()} />);

    expect(await screen.findByText("1 imported")).toBeInTheDocument();
    expect(mockFetchJob).toHaveBeenLastCalledWith("job-import-9");
  });

  it("closing a finished import clears it, so reopening starts from a blank dialog", async () => {
    mockTriggerStaffImport.mockResolvedValue({ jobId: "job-import-10" });
    mockFetchJob.mockResolvedValue(importJob("job-import-10", "succeeded"));
    const onOpenChange = jest.fn();

    const { rerender } = render(<StaffImportDialog open onOpenChange={onOpenChange} />, {
      wrapper: stableProviders(),
    });
    const user = userEvent.setup();
    await uploadCsv(user);
    await screen.findByText("1 imported");

    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    rerender(<StaffImportDialog open={false} onOpenChange={onOpenChange} />);
    rerender(<StaffImportDialog open onOpenChange={onOpenChange} />);

    expect(await screen.findByRole("button", { name: "Upload" })).toBeInTheDocument();
    expect(screen.queryByText("1 imported")).not.toBeInTheDocument();
    expect(window.sessionStorage.length).toBe(0);
  });

  it("drops a job whose poll the server refused (a 404) on close, rather than locking this tab's imports", async () => {
    mockTriggerStaffImport.mockResolvedValue({ jobId: "job-import-11" });
    mockFetchJob.mockRejectedValue(
      new ApiError({
        code: "not_found",
        message: "Not found.",
        status: 404,
        url: "/jobs/job-import-11",
      }),
    );
    const onOpenChange = jest.fn();

    const { rerender } = render(<StaffImportDialog open onOpenChange={onOpenChange} />, {
      wrapper: stableProviders(),
    });
    const user = userEvent.setup();
    await uploadCsv(user);
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("The import failed.");
    });

    // Nothing to run in the background — the footer says what closing really does.
    expect(screen.queryByRole("button", { name: "Run in background" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(2);

    await user.keyboard("{Escape}");
    rerender(<StaffImportDialog open={false} onOpenChange={onOpenChange} />);
    rerender(<StaffImportDialog open onOpenChange={onOpenChange} />);

    expect(await screen.findByRole("button", { name: "Upload" })).toBeInTheDocument();
    expect(screen.getByLabelText("File")).toBeEnabled();
    expect(window.sessionStorage.length).toBe(0);
  });
});
