import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { toast } from "sonner";
import type { ReactNode } from "react";

import { Services } from "@/services";
import { renderWithProviders } from "@/test-utils";
import messages from "../../../../../messages/en.json";

import { StaffImportDialog } from "../staff-import-dialog";

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
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
const mockToastError = toast.error as jest.MockedFunction<typeof toast.error>;

function csvFile() {
  return new File(["first_name,last_name"], "staff.csv", { type: "text/csv" });
}

describe("StaffImportDialog", () => {
  beforeEach(() => {
    mockTriggerStaffImport.mockReset();
    mockFetchJob.mockReset();
    mockToastError.mockReset();
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
        errors: [{ row: 3, field: "campus_code", issue: "Unknown campus code 'ZZZ'." }],
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

  it("shows an error toast when the poll request itself fails", async () => {
    mockTriggerStaffImport.mockResolvedValue({ jobId: "job-import-4" });
    mockFetchJob.mockRejectedValue(new Error("network error"));

    renderWithProviders(<StaffImportDialog open onOpenChange={jest.fn()} />);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("File"), csvFile());
    await user.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("The import failed.");
    });
  });

  it("shows a timeout toast when the job never reaches a terminal status", async () => {
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

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("Still running in the background — check back shortly.");
    });
    jest.useRealTimers();
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
});
