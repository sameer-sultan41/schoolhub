import { ApiError } from "@schoolhub/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { StudentsTable } from "@/features/students/students-table";
import { apiClient } from "@/lib/auth";

jest.mock("@/lib/auth", () => ({ apiClient: { get: jest.fn() } }));
// StudentsTable never calls useSession itself — it renders <Can>, which reads
// usePermission/useAnyPermission — so those two are the ones to mock.
jest.mock("@/hooks/use-session", () => ({
  usePermission: jest.fn(() => false),
  useAnyPermission: jest.fn(() => false),
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

// apiClient.get's static type comes from the real ApiClient class (the mock
// factory above only changes the runtime value), so typescript-eslint's
// unbound-method rule reads it as a class-method reference — it is not one at
// runtime, it is jest.fn(), so it is safe to reference bare here.
// eslint-disable-next-line @typescript-eslint/unbound-method
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

const STUDENT = {
  id: "s1",
  admission_number: "2026-0001",
  first_name: "Amina",
  last_name: "Khan",
  preferred_name: null,
  status: "active",
};

describe("StudentsTable", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("shows skeleton rows while loading", () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<StudentsTable />);

    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
  });

  it("renders rows once data resolves", async () => {
    mockGet.mockResolvedValue({
      data: [STUDENT],
      meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 25 } },
    });

    renderWithProviders(<StudentsTable />);

    expect(await screen.findByText("2026-0001")).toBeInTheDocument();
    expect(screen.getByText("Amina Khan")).toBeInTheDocument();
  });

  it("shows the translated empty state when the result set is empty", async () => {
    mockGet.mockResolvedValue({
      data: [],
      meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 25 } },
    });

    renderWithProviders(<StudentsTable />);

    expect(await screen.findByText("No students found.")).toBeInTheDocument();
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
    mockGet.mockResolvedValue({
      data: [STUDENT],
      meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 25 } },
    });

    renderWithProviders(<StudentsTable />);

    const nextButton = await screen.findByRole("button", { name: "Next" });
    expect(nextButton).toBeDisabled();
  });
});
