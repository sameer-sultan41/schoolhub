import { ApiError } from "@schoolhub/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { EditStaffForm } from "@/features/staff/edit-staff-form";
import { apiClient } from "@/lib/auth";

jest.mock("@/lib/auth", () => ({ apiClient: { get: jest.fn() } }));
jest.mock("@/features/staff/staff-form", () => ({
  StaffForm: ({ mode, staff }: { mode: string; staff: { first_name: string } }) => (
    <div data-testid="staff-form" data-mode={mode}>
      {staff.first_name}
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

const BASE_STAFF = {
  id: "st1",
  employee_number: "EMP-0001",
  first_name: "Bilal",
  last_name: "Ahmed",
  gender: "male" as const,
  date_of_birth: "1985-06-01",
  staff_type: "teaching" as const,
  campus_id: "c1",
  department_id: null,
  designation_id: null,
  employment_type: "full_time" as const,
  employment_status: "active" as const,
  joining_date: "2026-04-01",
  exit_date: null,
  exit_reason: null,
  email: null,
  phone: "+923001234567",
  national_id: null,
  public_bio: null,
  address: null,
  custom_fields: {},
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
};

describe("EditStaffForm", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("shows a skeleton while the record loads", () => {
    mockGet.mockReturnValue(new Promise(() => {}));

    renderWithProviders(<EditStaffForm staffId="st1" />);

    expect(screen.queryByTestId("staff-form")).not.toBeInTheDocument();
  });

  it("renders the edit-mode form with the loaded record once resolved", async () => {
    mockGet.mockResolvedValue(apiResult(BASE_STAFF));

    renderWithProviders(<EditStaffForm staffId="st1" />);

    const form = await screen.findByTestId("staff-form");
    expect(form).toHaveAttribute("data-mode", "edit");
    expect(form).toHaveTextContent("Bilal");
  });

  it("shows a mapped error message for a known API error code", async () => {
    mockGet.mockRejectedValue(
      new ApiError({ code: "not_found", message: "not found", status: 404, url: "/staff/st1" }),
    );

    renderWithProviders(<EditStaffForm staffId="st1" />);

    expect(await screen.findByText(/could not find/i)).toBeInTheDocument();
  });

  it("falls back to the raw message for an unmapped error code, with the request id", async () => {
    mockGet.mockRejectedValue(
      new ApiError({
        code: "weird_unmapped_code",
        message: "Something specific broke",
        status: 500,
        url: "/staff/st1",
        requestId: "req-9",
      }),
    );

    renderWithProviders(<EditStaffForm staffId="st1" />);

    expect(await screen.findByText(/Something specific broke/)).toBeInTheDocument();
    expect(screen.getByText(/req-9/)).toBeInTheDocument();
  });
});
