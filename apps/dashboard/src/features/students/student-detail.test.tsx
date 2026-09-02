import { ApiError } from "@schoolhub/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { StudentDetail } from "@/features/students/student-detail";
import { apiClient } from "@/lib/auth";

jest.mock("@/lib/auth", () => ({ apiClient: { get: jest.fn() } }));
jest.mock("@/hooks/use-session", () => ({
  usePermission: jest.fn(() => false),
  useAnyPermission: jest.fn(() => false),
}));

// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

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

const BASE_STUDENT = {
  id: "s1",
  admission_number: "2026-0001",
  first_name: "Amina",
  last_name: "Khan",
  preferred_name: null,
  date_of_birth: "2015-06-01",
  gender: "female" as const,
  campus_id: "c1",
  house_id: null,
  status: "active" as const,
  admission_date: "2026-04-01",
  blood_group: null,
  nationality: null,
  religion: null,
  previous_school: null,
  address: null,
  custom_fields: {},
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
};

describe("StudentDetail", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("renders the student's name and admission number once loaded", async () => {
    mockGet.mockResolvedValue(apiResult(BASE_STUDENT));

    renderWithProviders(<StudentDetail studentId="s1" />);

    expect(await screen.findByRole("heading", { name: "Amina Khan" })).toBeInTheDocument();
    expect(screen.getByText("2026-0001")).toBeInTheDocument();
  });

  it("does not render a medical notes section when the field is absent from the payload", async () => {
    mockGet.mockResolvedValue(apiResult(BASE_STUDENT));

    renderWithProviders(<StudentDetail studentId="s1" />);

    await screen.findByRole("heading", { name: "Amina Khan" });
    expect(screen.queryByText("Medical notes")).not.toBeInTheDocument();
  });

  it("renders the medical notes section when the server includes the field", async () => {
    mockGet.mockResolvedValue(apiResult({ ...BASE_STUDENT, medical_notes: "Penicillin allergy" }));

    renderWithProviders(<StudentDetail studentId="s1" />);

    expect(await screen.findByText("Penicillin allergy")).toBeInTheDocument();
    expect(screen.getByText("Restricted")).toBeInTheDocument();
  });

  it("renders an em dash for a null medical_notes value that IS present in the payload", async () => {
    mockGet.mockResolvedValue(apiResult({ ...BASE_STUDENT, medical_notes: null }));

    renderWithProviders(<StudentDetail studentId="s1" />);

    await screen.findByRole("heading", { name: "Amina Khan" });
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders the ApiError envelope on a request failure", async () => {
    mockGet.mockRejectedValue(
      new ApiError({
        code: "not_found",
        message: "not found",
        status: 404,
        url: "/students/s1",
        requestId: "req-2",
      }),
    );

    renderWithProviders(<StudentDetail studentId="s1" />);

    expect(await screen.findByText(/could not find/i)).toBeInTheDocument();
  });
});
