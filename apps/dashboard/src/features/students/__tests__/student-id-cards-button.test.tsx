import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { Services } from "@/services";
import type { BackgroundJobRecord } from "@/services/modules/jobs/jobs-service";

import messages from "../../../../messages/en.json";
import { StudentIdCardsButton } from "../student-id-cards-button";

jest.mock("@/services", () => ({
  Services: {
    students: { generateIdCards: jest.fn() },
    jobs: { fetchJob: jest.fn(), fetchFileDownloadUrl: jest.fn() },
  },
}));

// Failure and timeout states surface only as toasts, and no `<Toaster/>` is mounted here.
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

const mockGenerateIdCards = Services.students.generateIdCards as jest.MockedFunction<
  typeof Services.students.generateIdCards
>;
const mockFetchJob = Services.jobs.fetchJob as jest.MockedFunction<typeof Services.jobs.fetchJob>;
const mockFetchFileDownloadUrl = Services.jobs.fetchFileDownloadUrl as jest.MockedFunction<
  typeof Services.jobs.fetchFileDownloadUrl
>;
const mockToastSuccess = toast.success as jest.MockedFunction<typeof toast.success>;
const mockToastError = toast.error as jest.MockedFunction<typeof toast.error>;

function idCardJob(
  id: string,
  status: "running" | "succeeded",
  progress: number,
): BackgroundJobRecord {
  return {
    id,
    job_type: "id-cards.generate",
    status,
    progress,
    result: status === "succeeded" ? { result_file_id: "f1", count: 2 } : null,
    error: null,
  };
}

/** One client per test, shared by every `rerender`: a bare `renderWithProviders` result
 * would drop the providers on `rerender` and lose the hook's job state with them. */
function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale="en" messages={messages}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </NextIntlClientProvider>
    );
  };
}

describe("StudentIdCardsButton", () => {
  beforeEach(() => {
    mockGenerateIdCards.mockReset();
    mockFetchJob.mockReset();
    mockFetchFileDownloadUrl.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
  });

  // Teardown here, not at the end of a test, so a failing assertion can't leak fake timers
  // or the anchor-click spy into the next test.
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("renders nothing with no selection and no job", () => {
    render(<StudentIdCardsButton studentIds={[]} />, { wrapper: makeWrapper() });

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("posts the selected ids and downloads the PDF once the job succeeds", async () => {
    mockGenerateIdCards.mockResolvedValue({ jobId: "job-1" });
    mockFetchJob.mockResolvedValue(idCardJob("job-1", "succeeded", 100));
    mockFetchFileDownloadUrl.mockResolvedValue("https://storage.test/id-cards.pdf");
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<StudentIdCardsButton studentIds={["s1", "s2"]} />, { wrapper: makeWrapper() });
    await userEvent.setup().click(screen.getByRole("button", { name: "Generate ID cards (2)" }));

    await waitFor(() => {
      expect(mockGenerateIdCards).toHaveBeenCalledWith(["s1", "s2"]);
    });
    await waitFor(() => {
      expect(mockFetchFileDownloadUrl).toHaveBeenCalledWith("f1");
    });
    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith("ID cards ready (2)");
    });
    expect(clickSpy).toHaveBeenCalledTimes(1);
    const anchor = clickSpy.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.href).toBe("https://storage.test/id-cards.pdf");
    expect(anchor.download).toBe("id-cards.pdf");
  });

  it("stays visible and disabled while generating after the selection empties", async () => {
    mockGenerateIdCards.mockResolvedValue({ jobId: "job-2" });
    mockFetchJob.mockResolvedValue(idCardJob("job-2", "running", 40));

    const { rerender } = render(<StudentIdCardsButton studentIds={["s1", "s2"]} />, {
      wrapper: makeWrapper(),
    });
    await userEvent.setup().click(screen.getByRole("button", { name: "Generate ID cards (2)" }));
    expect(await screen.findByRole("button", { name: "Generating — 40%" })).toBeDisabled();

    rerender(<StudentIdCardsButton studentIds={[]} />);

    expect(screen.getByRole("button", { name: "Generating — 40%" })).toBeDisabled();
    expect(mockGenerateIdCards).toHaveBeenCalledTimes(1);
  });

  it("offers Check ID-card status after a timeout and resumes the same job, even with no selection", async () => {
    jest.useFakeTimers({ advanceTimers: true });
    mockGenerateIdCards.mockResolvedValue({ jobId: "job-3" });
    mockFetchJob.mockResolvedValue(idCardJob("job-3", "running", 40));
    mockFetchFileDownloadUrl.mockResolvedValue("https://storage.test/id-cards.pdf");
    jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const { rerender } = render(<StudentIdCardsButton studentIds={["s1", "s2"]} />, {
      wrapper: makeWrapper(),
    });
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("button", { name: "Generate ID cards (2)" }));

    await jest.advanceTimersByTimeAsync(120_000);
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining("taking longer"));
    });

    // The selection clears while the job is no longer watched: the resume button must stay.
    rerender(<StudentIdCardsButton studentIds={[]} />);
    const checkStatus = await screen.findByRole("button", { name: "Check ID-card status" });
    expect(checkStatus).toBeEnabled();

    // The job finishes server-side while nobody is watching it.
    mockFetchJob.mockResolvedValue(idCardJob("job-3", "succeeded", 100));
    await user.click(checkStatus);

    await waitFor(() => {
      expect(mockFetchFileDownloadUrl).toHaveBeenCalledWith("f1");
    });
    expect(mockGenerateIdCards).toHaveBeenCalledTimes(1);
    expect(mockFetchJob).toHaveBeenLastCalledWith("job-3");
  });
});
