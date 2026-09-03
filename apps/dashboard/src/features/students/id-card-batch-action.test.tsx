import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { IdCardBatchAction } from "@/features/students/id-card-batch-action";
import { apiClient } from "@/lib/auth";

jest.mock("@/lib/auth", () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;

function apiResult<T>(data: T) {
  return { data, meta: undefined, requestId: null, status: 200 };
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

describe("IdCardBatchAction", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it("disables the generate button when nothing is selected", () => {
    renderWithProviders(<IdCardBatchAction selectedIds={[]} onDone={jest.fn()} />);

    expect(screen.getByRole("button", { name: "Generate ID cards (0)" })).toBeDisabled();
  });

  it("requests generation and offers a download once the job succeeds", async () => {
    mockPost.mockImplementation((path: string) => {
      if (path === "/id-cards:generate") return Promise.resolve(apiResult({ job_id: "job1" }));
      throw new Error(`unexpected path ${path}`);
    });
    mockGet.mockResolvedValue(
      apiResult({
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
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<IdCardBatchAction selectedIds={["s1"]} onDone={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: "Generate ID cards (1)" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/id-cards:generate", { student_ids: ["s1"] });
    });
    expect(await screen.findByRole("button", { name: "Download PDF" })).toBeInTheDocument();
  });

  it("downloads the merged PDF when Download is clicked", async () => {
    mockPost.mockImplementation((path: string) => {
      if (path === "/id-cards:generate") return Promise.resolve(apiResult({ job_id: "job1" }));
      if (path === "/files/f1:download") {
        return Promise.resolve(apiResult({ download_url: "https://storage.invalid/f1" }));
      }
      throw new Error(`unexpected path ${path}`);
    });
    mockGet.mockResolvedValue(
      apiResult({
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
      }),
    );
    const mockOpen = jest.fn();
    window.open = mockOpen;

    const user = userEvent.setup();
    renderWithProviders(<IdCardBatchAction selectedIds={["s1"]} onDone={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: "Generate ID cards (1)" }));
    await user.click(await screen.findByRole("button", { name: "Download PDF" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/files/f1:download");
    });
    expect(mockOpen).toHaveBeenCalledWith(
      "https://storage.invalid/f1",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("dismisses a succeeded job and calls onDone", async () => {
    mockPost.mockResolvedValue(apiResult({ job_id: "job1" }));
    mockGet.mockResolvedValue(
      apiResult({
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
      }),
    );
    const onDone = jest.fn();

    const user = userEvent.setup();
    renderWithProviders(<IdCardBatchAction selectedIds={["s1"]} onDone={onDone} />);

    await user.click(screen.getByRole("button", { name: "Generate ID cards (1)" }));
    await user.click(await screen.findByRole("button", { name: "Dismiss" }));

    expect(onDone).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Generate ID cards (1)" })).toBeInTheDocument();
  });

  it("shows the job's error when generation fails", async () => {
    mockPost.mockResolvedValue(apiResult({ job_id: "job2" }));
    mockGet.mockResolvedValue(
      apiResult({
        id: "job2",
        job_type: "id-cards.generate",
        status: "failed",
        progress: 40,
        result: null,
        error: "Something went wrong",
        started_at: null,
        finished_at: null,
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:00:00Z",
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<IdCardBatchAction selectedIds={["s1"]} onDone={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: "Generate ID cards (1)" }));

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
  });

  it("dismisses a failed job", async () => {
    mockPost.mockResolvedValue(apiResult({ job_id: "job2" }));
    mockGet.mockResolvedValue(
      apiResult({
        id: "job2",
        job_type: "id-cards.generate",
        status: "failed",
        progress: 40,
        result: null,
        error: "Something went wrong",
        started_at: null,
        finished_at: null,
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:00:00Z",
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<IdCardBatchAction selectedIds={["s1"]} onDone={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: "Generate ID cards (1)" }));
    await screen.findByText("Something went wrong");
    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(screen.getByRole("button", { name: "Generate ID cards (1)" })).toBeInTheDocument();
  });
});
