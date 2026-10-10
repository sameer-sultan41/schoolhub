import { ApiError } from "@schoolhub/api-client";
import type { AuthenticatedUser } from "@schoolhub/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { IMPORT_FILE_EXTENSIONS } from "@/lib/constants";
import { Services } from "@/services";
import type { BackgroundJobRecord, JobStatus } from "@/services/modules/jobs/jobs-service";
import { renderWithProviders, setMatchesMobile } from "@/test-utils";

import messages from "../../../messages/en.json";
import { BulkImportDialog, type BulkImportDialogProps } from "../bulk-import-dialog";

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    auth: { fetchCurrentUser: jest.fn() },
    jobs: { fetchJob: jest.fn() },
  },
}));

// `renderWithProviders` mounts no `<Toaster/>`, so a real (unmocked) `sonner` call reaches
// no DOM node a test could assert on — several paths here (a poll error, a timeout, the
// synchronous size-cap rejection) surface ONLY as a toast, with no inline element.
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

const mockStart = jest.fn<Promise<{ jobId: string }>, [File]>();
const mockFetchJob = Services.jobs.fetchJob as jest.MockedFunction<typeof Services.jobs.fetchJob>;
const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;
const mockToastError = toast.error as jest.MockedFunction<typeof toast.error>;

const IMPORTER: AuthenticatedUser = {
  id: "user-1",
  email: "importer@example.com",
  phone: null,
  full_name: "Importer",
  avatar_url: null,
  locale: "en",
  tenant_id: "tenant-1",
  roles: [],
  permissions: ["things.things.view", "things.things.import"],
};

/** The dialog with every required prop filled in; a test overrides only what it varies. */
function importDialog(props: Partial<BulkImportDialogProps> = {}) {
  return (
    <BulkImportDialog
      open
      onOpenChange={jest.fn()}
      module="things"
      title="Import things"
      description="Bulk-create things from a file."
      requiredColumns={["code"]}
      optionalColumns={["note"]}
      storageKeyPrefix="schoolhub:things-import-job:"
      start={mockStart}
      {...props}
    />
  );
}

function csvFile() {
  return new File(["code,note"], "things.csv", { type: "text/csv" });
}

function importJob(
  id: string,
  status: JobStatus,
  overrides: Partial<BackgroundJobRecord> = {},
): BackgroundJobRecord {
  return {
    id,
    job_type: "import.things",
    status,
    progress: status === "succeeded" ? 100 : 40,
    result: status === "succeeded" ? { total: 1, succeeded: 1, failed: 0, errors: [] } : null,
    error: null,
    ...overrides,
  };
}

function newQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** A local `wrapper` (RTL's own option, not `renderWithProviders`) is what makes `rerender`
 * re-apply the providers on every call: `renderWithProviders` returns a plain `render()`
 * result whose `rerender` swaps the ENTIRE tree for whatever element it's given, providers
 * included, so a `rerender` without this would drop the `QueryClientProvider`/
 * `NextIntlClientProvider` and throw the moment `useTranslations`/`useQuery` ran again.
 * Mirrors `staff-form-dialog.test.tsx`'s own identical regression test. One QueryClient
 * per call, shared across every `rerender`. */
function stableProviders(queryClient = newQueryClient()) {
  return function Providers({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale="en" messages={messages}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </NextIntlClientProvider>
    );
  };
}

function renderWithInvalidateSpy() {
  const queryClient = newQueryClient();
  const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");
  render(importDialog(), { wrapper: stableProviders(queryClient) });
  return invalidateSpy;
}

async function uploadCsv(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText("File"), csvFile());
  await user.click(screen.getByRole("button", { name: "Upload" }));
}

describe("BulkImportDialog", () => {
  beforeEach(() => {
    mockStart.mockReset();
    mockFetchJob.mockReset();
    mockFetchCurrentUser.mockReset().mockResolvedValue(IMPORTER);
    mockToastError.mockReset();
    window.sessionStorage.clear();
  });

  // Teardown here rather than at the end of a test, so a failing assertion can't leak fake
  // timers, a spy or the mobile viewport into the next test.
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    setMatchesMobile(false);
  });

  it("renders nothing (no dialog role) when closed", () => {
    renderWithProviders(importDialog({ open: false }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("takes its title, description and required/optional column badges from props", () => {
    renderWithProviders(importDialog());

    expect(screen.getByRole("dialog", { name: "Import things" })).toBeInTheDocument();
    expect(screen.getByText("Bulk-create things from a file.")).toBeInTheDocument();
    expect(screen.getByText("code")).toBeInTheDocument();
    expect(screen.getByText("note")).toBeInTheDocument();
  });

  it("offers the shared import file extensions on the file input", () => {
    renderWithProviders(importDialog());
    expect(screen.getByLabelText("File")).toHaveAttribute("accept", IMPORT_FILE_EXTENSIONS);
  });

  it("renders as a bottom drawer on mobile, with the same title and file field", () => {
    setMatchesMobile(true);
    const { baseElement } = renderWithProviders(importDialog());

    expect(baseElement.querySelector('[data-slot="drawer-content"]')).toBeInTheDocument();
    expect(baseElement.querySelector('[data-slot="dialog-content"]')).not.toBeInTheDocument();
    expect(screen.getByText("Import things")).toBeInTheDocument();
    expect(screen.getByLabelText("File")).toBeInTheDocument();
  });

  it("shows a per-row failure table when the import partially succeeds", async () => {
    mockStart.mockResolvedValue({ jobId: "job-import-1" });
    mockFetchJob.mockResolvedValue(
      importJob("job-import-1", "succeeded", {
        result: {
          total: 2,
          succeeded: 1,
          failed: 1,
          // A string, as the backend really sends it (`str(row_number)`).
          errors: [{ row: "3", field: "code", issue: "Unknown code 'ZZZ'." }],
        },
      }),
    );

    renderWithProviders(importDialog());
    const user = userEvent.setup();
    await uploadCsv(user);

    expect(mockStart).toHaveBeenCalledWith(expect.any(File));
    // Scoped to the error table specifically: "code" also appears in the always-rendered
    // required/optional columns hint above the file input, so an unscoped
    // `getByText("code")` would throw "found multiple elements" the instant this table
    // renders alongside it.
    const table = within(await screen.findByRole("table"));
    expect(table.getByText("3")).toBeInTheDocument();
    expect(table.getByText("code")).toBeInTheDocument();
    expect(table.getByText("Unknown code 'ZZZ'.")).toBeInTheDocument();
    expect(screen.getByText("1 imported")).toBeInTheDocument();
    expect(screen.getByText("1 failed")).toBeInTheDocument();
  });

  it("shows the server's real per-field validation message when the import file is rejected synchronously (over the size cap)", async () => {
    // `domain_rule_violation` is the REAL code the server's size-cap check raises — not
    // `validation_error`. Its mapped `errors.domain_rule_violation` message ("That action
    // isn't allowed right now.") is generic on purpose (the code covers many unrelated
    // business rules); the actually-useful text is the field-level `details` entry, which
    // is exactly what `ApiError.fieldErrors()` surfaces and what the component must prefer.
    mockStart.mockRejectedValue(
      new ApiError({
        code: "domain_rule_violation",
        message: "Import file exceeds the 5242880-byte limit.",
        status: 422,
        url: "/things-imports",
        details: [
          {
            field: "file",
            issue: "Import file exceeds the 5242880-byte limit.",
            code: "domain_rule_violation",
          },
        ],
      }),
    );

    renderWithProviders(importDialog());
    const user = userEvent.setup();
    await uploadCsv(user);

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("Import file exceeds the 5242880-byte limit.");
    });
  });

  it("falls back to its own message when the upload fails with no field detail", async () => {
    mockStart.mockRejectedValue(new Error("boom"));

    renderWithProviders(importDialog());
    const user = userEvent.setup();
    await uploadCsv(user);

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("The import could not be started.");
    });
  });

  it("shows the job's own raw failure message when the file parses but the job itself fails asynchronously", async () => {
    mockStart.mockResolvedValue({ jobId: "job-import-2" });
    mockFetchJob.mockResolvedValue(
      importJob("job-import-2", "failed", { progress: 0, error: "Unsupported xlsx format." }),
    );

    renderWithProviders(importDialog());
    const user = userEvent.setup();
    await uploadCsv(user);

    // Rendered inline (an `Alert`), unlike the synchronous case above — this one reads
    // real DOM text, not a toast call.
    expect(await screen.findByText("Unsupported xlsx format.")).toBeInTheDocument();
  });

  it("shows an error toast when the poll request itself fails, and keeps the file input locked so a re-upload can't create duplicates", async () => {
    mockStart.mockResolvedValue({ jobId: "job-import-4" });
    // Status 0 is what the api-client makes of a network failure — transient, so the job
    // is still one worth reconnecting to (unlike a refused 404, tested below).
    mockFetchJob.mockRejectedValue(
      new ApiError({
        code: "network_error",
        message: "Network request failed.",
        status: 0,
        url: "/jobs/job-import-4",
      }),
    );

    renderWithProviders(importDialog());
    const user = userEvent.setup();
    await uploadCsv(user);

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("The import failed.");
    });
    // The job's own status is unknown (the poll itself failed, not the job), so this must
    // not look like an idle dialog ready for a fresh file — the "Upload" button shouldn't
    // even be offered, and the footer reads "Run in background" (distinct from the dialog's
    // own built-in X button, also named "Close") since there is nothing left to cancel.
    expect(screen.getByLabelText("File")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Upload" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run in background" })).toBeInTheDocument();
  });

  it("shows a timeout toast when the job never reaches a terminal status, and keeps the file input locked", async () => {
    jest.useFakeTimers({ advanceTimers: true });
    mockStart.mockResolvedValue({ jobId: "job-import-5" });
    mockFetchJob.mockResolvedValue(importJob("job-import-5", "running", { progress: 10 }));

    renderWithProviders(importDialog());
    const user = userEvent.setup({ delay: null });
    await uploadCsv(user);

    await jest.advanceTimersByTimeAsync(120_000);

    const timedOutMessage = "Still running in the background — check back shortly.";
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(timedOutMessage);
    });
    // The import may well still be running server-side — re-enabling the file picker here
    // would invite a second, duplicate import of the same rows.
    expect(screen.getByLabelText("File")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Upload" })).not.toBeInTheDocument();
    expect(screen.getByText(timedOutMessage)).toBeInTheDocument();
  });

  it("invalidates the module's and the dashboard's queries once the import succeeds with at least one imported row", async () => {
    mockStart.mockResolvedValue({ jobId: "job-import-6" });
    mockFetchJob.mockResolvedValue(importJob("job-import-6", "succeeded"));
    const invalidateSpy = renderWithInvalidateSpy();
    const user = userEvent.setup();
    await uploadCsv(user);

    await screen.findByText("1 imported");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["things"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["dashboard"] });
  });

  it("leaves the cache alone when no row was imported", async () => {
    mockStart.mockResolvedValue({ jobId: "job-import-12" });
    mockFetchJob.mockResolvedValue(
      importJob("job-import-12", "succeeded", {
        result: {
          total: 1,
          succeeded: 0,
          failed: 1,
          errors: [{ row: "2", field: "code", issue: "Required." }],
        },
      }),
    );
    const invalidateSpy = renderWithInvalidateSpy();
    const user = userEvent.setup();
    await uploadCsv(user);

    await screen.findByText("0 imported");
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("stops polling once the dialog is closed mid-import", async () => {
    jest.useFakeTimers({ advanceTimers: true });
    mockStart.mockResolvedValue({ jobId: "job-import-3" });
    mockFetchJob.mockResolvedValue(importJob("job-import-3", "running", { progress: 0 }));
    const onOpenChange = jest.fn();

    const { rerender } = render(importDialog({ onOpenChange }), {
      wrapper: stableProviders(),
    });
    const user = userEvent.setup({ delay: null });
    await uploadCsv(user);

    await waitFor(() => {
      expect(mockFetchJob).toHaveBeenCalledTimes(1);
    });

    // Control: still open, still polling — a second poll fires after one more interval,
    // proving the fake-timer setup actually drives this query.
    await jest.advanceTimersByTimeAsync(2000);
    await waitFor(() => {
      expect(mockFetchJob).toHaveBeenCalledTimes(2);
    });

    rerender(importDialog({ open: false, onOpenChange }));

    const callsAtClose = mockFetchJob.mock.calls.length;
    await jest.advanceTimersByTimeAsync(10_000);
    expect(mockFetchJob.mock.calls.length).toBe(callsAtClose);
  });

  it("can't be closed while the upload is still in flight — Escape does nothing and the X is hidden", async () => {
    let resolveUpload: (value: { jobId: string }) => void = () => {};
    mockStart.mockReturnValue(
      new Promise<{ jobId: string }>((resolve) => {
        resolveUpload = resolve;
      }),
    );
    mockFetchJob.mockResolvedValue(importJob("job-import-7", "running"));
    const onOpenChange = jest.fn();

    renderWithProviders(importDialog({ onOpenChange }));
    const user = userEvent.setup();
    await uploadCsv(user);

    // Aborting the request couldn't stop a job the server may already have created, so no
    // close path is offered until it answers.
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
    mockStart.mockResolvedValue({ jobId: "job-import-8" });
    mockFetchJob.mockResolvedValue(importJob("job-import-8", "running"));
    const onOpenChange = jest.fn();

    const { rerender } = render(importDialog({ onOpenChange }), {
      wrapper: stableProviders(),
    });
    const user = userEvent.setup();
    await uploadCsv(user);
    await screen.findByText("Importing — 40%");

    await user.click(screen.getByRole("button", { name: "Run in background" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    rerender(importDialog({ open: false, onOpenChange }));
    const callsWhileClosed = mockFetchJob.mock.calls.length;

    mockFetchJob.mockResolvedValue(importJob("job-import-8", "running", { progress: 70 }));
    rerender(importDialog({ onOpenChange }));

    expect(await screen.findByText("Importing — 70%")).toBeInTheDocument();
    expect(mockFetchJob.mock.calls.length).toBeGreaterThan(callsWhileClosed);
    expect(screen.getByLabelText("File")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Upload" })).not.toBeInTheDocument();
  });

  it("reconnects to a background import after the dialog remounts, e.g. navigating away and back", async () => {
    mockStart.mockResolvedValue({ jobId: "job-import-9" });
    mockFetchJob.mockResolvedValue(importJob("job-import-9", "running"));

    const first = renderWithProviders(importDialog());
    const user = userEvent.setup();
    await uploadCsv(user);
    await screen.findByText("Importing — 40%");
    await user.click(screen.getByRole("button", { name: "Run in background" }));
    first.unmount();

    // It finished while the user was elsewhere.
    mockFetchJob.mockResolvedValue(importJob("job-import-9", "succeeded"));
    renderWithProviders(importDialog());

    expect(await screen.findByText("1 imported")).toBeInTheDocument();
    expect(mockFetchJob).toHaveBeenLastCalledWith("job-import-9");
  });

  it("stores a background import under the storage prefix plus the signed-in user's id", async () => {
    mockStart.mockResolvedValue({ jobId: "job-import-13" });
    mockFetchJob.mockResolvedValue(importJob("job-import-13", "running"));

    renderWithProviders(importDialog());
    const user = userEvent.setup();
    await uploadCsv(user);
    await screen.findByText("Importing — 40%");

    // The prefix prop plus the signed-in user's id — per user as well as per tab.
    expect(window.sessionStorage.getItem("schoolhub:things-import-job:user-1")).toBe(
      "job-import-13",
    );
  });

  it("closing a finished import clears it, so reopening starts from a blank dialog", async () => {
    mockStart.mockResolvedValue({ jobId: "job-import-10" });
    mockFetchJob.mockResolvedValue(importJob("job-import-10", "succeeded"));
    const onOpenChange = jest.fn();

    const { rerender } = render(importDialog({ onOpenChange }), {
      wrapper: stableProviders(),
    });
    const user = userEvent.setup();
    await uploadCsv(user);
    await screen.findByText("1 imported");

    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    rerender(importDialog({ open: false, onOpenChange }));
    rerender(importDialog({ onOpenChange }));

    expect(await screen.findByRole("button", { name: "Upload" })).toBeInTheDocument();
    expect(screen.queryByText("1 imported")).not.toBeInTheDocument();
    expect(window.sessionStorage.length).toBe(0);
  });

  it("drops a job whose poll the server refused (a 404) on close, rather than locking this tab's imports", async () => {
    mockStart.mockResolvedValue({ jobId: "job-import-11" });
    mockFetchJob.mockRejectedValue(
      new ApiError({
        code: "not_found",
        message: "Not found.",
        status: 404,
        url: "/jobs/job-import-11",
      }),
    );
    const onOpenChange = jest.fn();

    const { rerender } = render(importDialog({ onOpenChange }), {
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
    rerender(importDialog({ open: false, onOpenChange }));
    rerender(importDialog({ onOpenChange }));

    expect(await screen.findByRole("button", { name: "Upload" })).toBeInTheDocument();
    expect(screen.getByLabelText("File")).toBeEnabled();
    expect(window.sessionStorage.length).toBe(0);
  });
});
