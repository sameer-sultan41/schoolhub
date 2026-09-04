import { ApiError } from "@schoolhub/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { StaffDetail } from "@/features/staff/staff-detail";
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
  email: "bilal@cityschool.test",
  phone: "+923001234567",
  national_id: null,
  public_bio: null,
  address: null,
  custom_fields: {},
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
};

describe("StaffDetail", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("renders the staff member's name and employee number once loaded", async () => {
    mockGet.mockResolvedValue(apiResult(BASE_STAFF));

    renderWithProviders(<StaffDetail staffId="st1" />);

    expect(await screen.findByRole("heading", { name: "Bilal Ahmed" })).toBeInTheDocument();
    expect(screen.getByText("EMP-0001")).toBeInTheDocument();
  });

  it("does not render a public-bio card when the field is null", async () => {
    mockGet.mockResolvedValue(apiResult(BASE_STAFF));

    renderWithProviders(<StaffDetail staffId="st1" />);

    await screen.findByRole("heading", { name: "Bilal Ahmed" });
    expect(screen.queryByText("Public bio")).not.toBeInTheDocument();
  });

  it("renders the public-bio card when the server includes a value", async () => {
    mockGet.mockResolvedValue(
      apiResult({ ...BASE_STAFF, public_bio: "Twelve years teaching mathematics." }),
    );

    renderWithProviders(<StaffDetail staffId="st1" />);

    expect(await screen.findByText("Twelve years teaching mathematics.")).toBeInTheDocument();
    expect(screen.getByText("Public bio")).toBeInTheDocument();
  });

  it("renders an em dash for a null date of birth", async () => {
    mockGet.mockResolvedValue(apiResult({ ...BASE_STAFF, date_of_birth: null }));

    renderWithProviders(<StaffDetail staffId="st1" />);

    await screen.findByRole("heading", { name: "Bilal Ahmed" });
    const dateOfBirthLabel = screen.getByText("Date of birth");
    expect(dateOfBirthLabel.nextElementSibling).toHaveTextContent("—");
  });

  it("renders an em dash for a null email", async () => {
    mockGet.mockResolvedValue(apiResult({ ...BASE_STAFF, email: null }));

    renderWithProviders(<StaffDetail staffId="st1" />);

    await screen.findByRole("heading", { name: "Bilal Ahmed" });
    const emailLabel = screen.getByText("Email");
    expect(emailLabel.nextElementSibling).toHaveTextContent("—");
  });

  it("renders the ApiError envelope on a request failure", async () => {
    mockGet.mockRejectedValue(
      new ApiError({
        code: "not_found",
        message: "not found",
        status: 404,
        url: "/staff/st1",
        requestId: "req-2",
      }),
    );

    renderWithProviders(<StaffDetail staffId="st1" />);

    expect(await screen.findByText(/could not find/i)).toBeInTheDocument();
  });

  it("falls back to the raw message for an unmapped error code, with no request id", async () => {
    mockGet.mockRejectedValue(
      new ApiError({
        code: "weird_unmapped_code",
        message: "Something specific broke",
        status: 500,
        url: "/staff/st1",
      }),
    );

    renderWithProviders(<StaffDetail staffId="st1" />);

    expect(await screen.findByText("Something specific broke")).toBeInTheDocument();
  });

  it("switches to the Qualifications tab and renders that tab's panel", async () => {
    mockGet.mockImplementation((path: string) => {
      if (path === "/staff/st1") return Promise.resolve(apiResult(BASE_STAFF));
      if (path === "/staff/st1/qualifications") return Promise.resolve(apiResult([]));
      throw new Error(`unexpected path ${path}`);
    });

    const user = userEvent.setup();
    renderWithProviders(<StaffDetail staffId="st1" />);

    await screen.findByRole("heading", { name: "Bilal Ahmed" });
    await user.click(screen.getByRole("tab", { name: "Qualifications" }));

    expect(await screen.findByText("No qualifications added yet.")).toBeInTheDocument();
  });
});
