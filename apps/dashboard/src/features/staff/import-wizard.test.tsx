import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { ImportWizard } from "@/features/staff/import-wizard";
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

describe("ImportWizard", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it("lists the required and optional template columns", () => {
    renderWithProviders(<ImportWizard />);

    expect(screen.getByText("first_name")).toBeInTheDocument();
    expect(screen.getByText("gender")).toBeInTheDocument();
  });

  it("disables upload until a file is chosen", () => {
    renderWithProviders(<ImportWizard />);

    expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
  });

  it("uploads the file and renders the row-level error report", async () => {
    mockPost.mockImplementation((path: string) => {
      if (path === "/staff-imports") return Promise.resolve(apiResult({ job_id: "job1" }));
      throw new Error(`unexpected path ${path}`);
    });
    mockGet.mockResolvedValue(
      apiResult({
        id: "job1",
        job_type: "import.staff",
        status: "succeeded",
        progress: 100,
        result: {
          total: 2,
          succeeded: 1,
          failed: 1,
          errors: [{ row: "3", field: "campus_code", issue: "No campus with code 'NOPE'." }],
        },
        error: null,
        started_at: null,
        finished_at: null,
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:00:00Z",
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<ImportWizard />);

    const file = new File(["a,b\n1,2"], "staff.csv", { type: "text/csv" });
    await user.upload(screen.getByLabelText("File"), file);
    await user.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/staff-imports", expect.any(FormData));
    });
    expect(await screen.findByText("1 imported")).toBeInTheDocument();
    expect(screen.getByText("1 failed")).toBeInTheDocument();
    expect(screen.getByText("No campus with code 'NOPE'.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Import another file" }));

    expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
    expect(screen.queryByText("1 imported")).not.toBeInTheDocument();
  });
});
