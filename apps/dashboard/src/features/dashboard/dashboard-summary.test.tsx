import type { AuthenticatedUser, PermissionKey } from "@schoolhub/types";
import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils";
import { useSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";
import { DashboardSummary } from "./dashboard-summary";

jest.mock("@/hooks/use-session", () => ({
  useSession: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  apiClient: { get: jest.fn() },
}));

const mockUseSession = useSession as jest.MockedFunction<typeof useSession>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

function apiResult<T>(data: T) {
  return { data, meta: undefined, requestId: null, status: 200 };
}

function makeUser(permissions: PermissionKey[]): AuthenticatedUser {
  return {
    id: "u1",
    email: "admin@cityschool.test",
    phone: null,
    full_name: "Ayesha Khan",
    avatar_url: null,
    locale: "en",
    tenant_id: "t1",
    roles: [],
    permissions,
  };
}

describe("DashboardSummary", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockUseSession.mockReset();
    mockUseSession.mockReturnValue({
      user: makeUser([
        "students.student.view",
        "attendance.student-attendance.view",
        "fees.invoice.view",
        "admissions.enquiry.view",
      ]),
      isLoading: false,
      isAuthenticated: true,
      refetch: jest.fn(),
    });
  });

  it("shows a skeleton for every visible tile while loading", () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<DashboardSummary />);

    expect(screen.getByText("Enrolled students")).toBeInTheDocument();
    expect(screen.getByText("Outstanding fees")).toBeInTheDocument();
  });

  it("renders formatted values once the data resolves", async () => {
    mockGet.mockResolvedValue(
      apiResult({
        students_enrolled: 1234,
        attendance_rate_today: 92.5,
        fees_outstanding_minor_units: 150000,
        open_admission_enquiries: 7,
        currency: "PKR",
      }),
    );

    renderWithProviders(<DashboardSummary />);

    await waitFor(() => {
      expect(screen.getByText("1,234")).toBeInTheDocument();
    });
    expect(screen.getByText("92.5%")).toBeInTheDocument();
    // Built via the same Intl call, not a hand-typed literal — ICU inserts a
    // non-breaking space between "PKR" and the amount, and PKR's CLDR data formats with
    // 0 fraction digits by default.
    const expectedFees = new Intl.NumberFormat("en", {
      style: "currency",
      currency: "PKR",
    }).format(1500);
    expect(screen.getByText(expectedFees)).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("only renders tiles the user has permission for", async () => {
    mockUseSession.mockReturnValue({
      user: makeUser(["students.student.view"]),
      isLoading: false,
      isAuthenticated: true,
      refetch: jest.fn(),
    });
    mockGet.mockResolvedValue(
      apiResult({
        students_enrolled: 10,
        attendance_rate_today: null,
        fees_outstanding_minor_units: 0,
        open_admission_enquiries: 0,
        currency: "PKR",
      }),
    );

    renderWithProviders(<DashboardSummary />);

    await waitFor(() => {
      expect(screen.getByText("Enrolled students")).toBeInTheDocument();
    });
    expect(screen.queryByText("Outstanding fees")).not.toBeInTheDocument();
  });

  it("shows a placeholder when attendance has no data yet", async () => {
    mockGet.mockResolvedValue(
      apiResult({
        students_enrolled: 10,
        attendance_rate_today: null,
        fees_outstanding_minor_units: 0,
        open_admission_enquiries: 0,
        currency: "PKR",
      }),
    );

    renderWithProviders(<DashboardSummary />);

    await waitFor(() => {
      expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    });
  });

  it("shows a mapped error message for a known API error code", async () => {
    mockGet.mockRejectedValue(
      new ApiError({ code: "server_error", message: "boom", status: 500, url: "/x" }),
    );

    renderWithProviders(<DashboardSummary />);

    await waitFor(() => {
      expect(
        screen.getByText("Something went wrong on our side. The team has been notified."),
      ).toBeInTheDocument();
    });
  });

  it("falls back to the raw message for an unmapped error code, with the request id", async () => {
    mockGet.mockRejectedValue(
      new ApiError({
        code: "weird_unmapped_code",
        message: "Something specific broke",
        status: 500,
        url: "/x",
        requestId: "req-123",
      }),
    );

    renderWithProviders(<DashboardSummary />);

    await waitFor(() => {
      expect(screen.getByText(/Something specific broke/)).toBeInTheDocument();
    });
    expect(screen.getByText(/req-123/)).toBeInTheDocument();
  });
});
