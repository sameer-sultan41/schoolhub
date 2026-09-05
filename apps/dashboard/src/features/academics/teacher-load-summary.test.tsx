import { ApiError } from "@schoolhub/api-client";
import { screen } from "@testing-library/react";
import { TeacherLoadSummary } from "@/features/academics/teacher-load-summary";
import { apiClient } from "@/lib/auth";
import { renderWithProviders } from "@/test-utils";

jest.mock("@/lib/auth", () => ({ apiClient: { get: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

function result(rows: unknown[]) {
  return { data: rows, meta: undefined, requestId: null, status: 200 };
}

describe("TeacherLoadSummary", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("asks for the load summary of the session it was given", async () => {
    mockGet.mockResolvedValue(result([]));

    renderWithProviders(<TeacherLoadSummary academicSessionId="sess1" />);

    expect(await screen.findByText("No allocations in this session yet.")).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith("/teacher-subject-allocations/load-summary", {
      query: { academic_session_id: "sess1" },
    });
  });

  it("shows skeleton rows while loading and names the norm", () => {
    mockGet.mockReturnValue(new Promise(() => undefined));

    renderWithProviders(<TeacherLoadSummary academicSessionId="sess1" />);

    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByText(
        "Weekly periods per teacher for the selected session, against a norm of 30.",
      ),
    ).toBeInTheDocument();
  });

  it("badges an over-norm teacher and a within-norm teacher differently", async () => {
    mockGet.mockResolvedValue(
      result([
        {
          staff_id: "s1",
          name: "Bilal Ahmed",
          weekly_periods: 34,
          allocations: 7,
          over_norm: true,
        },
        {
          staff_id: "s2",
          name: "Sana Malik",
          weekly_periods: 18,
          allocations: 4,
          over_norm: false,
        },
      ]),
    );

    renderWithProviders(<TeacherLoadSummary academicSessionId="sess1" />);

    expect(await screen.findByText("Bilal Ahmed")).toBeInTheDocument();
    expect(screen.getByText("Over norm")).toBeInTheDocument();
    expect(screen.getByText("Within norm")).toBeInTheDocument();
    expect(screen.getByText("34")).toBeInTheDocument();
    expect(screen.getByText("18")).toBeInTheDocument();
  });

  it("renders the error envelope instead of the table on failure", async () => {
    mockGet.mockRejectedValue(
      new ApiError({
        code: "domain_rule_violation",
        message: "This query parameter is required.",
        status: 422,
        url: "/teacher-subject-allocations/load-summary",
        requestId: "req-8",
      }),
    );

    renderWithProviders(<TeacherLoadSummary academicSessionId="sess1" />);

    expect(await screen.findByText(/isn't allowed right now/i)).toBeInTheDocument();
    expect(screen.getByText(/Reference: req-8/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
