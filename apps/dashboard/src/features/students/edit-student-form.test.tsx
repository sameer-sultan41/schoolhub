import { ApiError } from "@schoolhub/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { EditStudentForm } from "@/features/students/edit-student-form";
import { apiClient } from "@/lib/auth";

jest.mock("@/lib/auth", () => ({ apiClient: { get: jest.fn() } }));
jest.mock("@/features/students/student-form", () => ({
  StudentForm: ({ mode, student }: { mode: string; student: { first_name: string } }) => (
    <div data-testid="student-form" data-mode={mode}>
      {student.first_name}
    </div>
  ),
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

describe("EditStudentForm", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("shows a skeleton while the record loads", () => {
    mockGet.mockReturnValue(new Promise(() => {}));

    renderWithProviders(<EditStudentForm studentId="s1" />);

    expect(screen.queryByTestId("student-form")).not.toBeInTheDocument();
  });

  it("renders the edit-mode form with the loaded record once resolved", async () => {
    mockGet.mockResolvedValue(apiResult(BASE_STUDENT));

    renderWithProviders(<EditStudentForm studentId="s1" />);

    const form = await screen.findByTestId("student-form");
    expect(form).toHaveAttribute("data-mode", "edit");
    expect(form).toHaveTextContent("Amina");
  });

  it("shows a mapped error message for a known API error code", async () => {
    mockGet.mockRejectedValue(
      new ApiError({ code: "not_found", message: "not found", status: 404, url: "/students/s1" }),
    );

    renderWithProviders(<EditStudentForm studentId="s1" />);

    expect(await screen.findByText(/could not find/i)).toBeInTheDocument();
  });

  it("falls back to the raw message for an unmapped error code, with the request id", async () => {
    mockGet.mockRejectedValue(
      new ApiError({
        code: "weird_unmapped_code",
        message: "Something specific broke",
        status: 500,
        url: "/students/s1",
        requestId: "req-9",
      }),
    );

    renderWithProviders(<EditStudentForm studentId="s1" />);

    expect(await screen.findByText(/Something specific broke/)).toBeInTheDocument();
    expect(screen.getByText(/req-9/)).toBeInTheDocument();
  });
});
