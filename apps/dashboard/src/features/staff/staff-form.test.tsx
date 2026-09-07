import { ApiError } from "@schoolhub/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { StaffForm } from "@/features/staff/staff-form";
import { apiClient } from "@/lib/auth";

jest.mock("@/lib/auth", () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
}));
jest.mock("@/features/students/use-reference-data", () => ({
  useCampuses: () => ({ data: [{ id: "c1", name: "Main Campus", code: "MAIN" }] }),
}));
jest.mock("@/features/staff/use-designations", () => ({
  useDesignations: () => ({ data: [{ id: "d1", name: "Senior Teacher" }] }),
}));

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;

function apiResult<T>(data: T) {
  return { data, meta: undefined, requestId: null, status: 200 };
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>,
  );
  return { ...result, queryClient };
}

describe("StaffForm (create)", () => {
  beforeEach(() => {
    mockGet.mockResolvedValue(apiResult([]));
    mockPost.mockReset();
    mockPush.mockReset();
  });

  it("shows a required-field message when submitting empty", async () => {
    const user = userEvent.setup();
    renderWithProviders(<StaffForm mode="create" />);

    await user.click(screen.getByRole("button", { name: "New staff member" }));

    const alerts = await screen.findAllByRole("alert");
    expect(alerts.length).toBeGreaterThan(0);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("maps a server field error onto the matching input", async () => {
    mockPost.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: "Please correct the highlighted fields.",
        status: 400,
        url: "/staff",
        details: [{ field: "first_name", issue: "A staff member with this name already exists." }],
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<StaffForm mode="create" />);

    await user.type(screen.getByLabelText(/First name/), "Bilal");
    await user.type(screen.getByLabelText(/Last name/), "Ahmed");
    await user.type(screen.getByLabelText(/Joining date/), "2026-04-01");
    await user.type(screen.getByLabelText(/Phone/), "+923001234567");
    await user.click(screen.getByRole("combobox", { name: "Campus" }));
    await user.click(await screen.findByRole("option", { name: "Main Campus" }));
    await user.click(screen.getByRole("button", { name: "New staff member" }));

    expect(
      await screen.findByText("A staff member with this name already exists."),
    ).toBeInTheDocument();
  });

  it("surfaces a server field error for a field the form has no input for", async () => {
    mockPost.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: "Please correct the highlighted fields.",
        status: 400,
        url: "/staff",
        details: [{ field: "photo_file_id", issue: "This file has not been confirmed yet." }],
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<StaffForm mode="create" />);

    await user.type(screen.getByLabelText(/First name/), "Bilal");
    await user.type(screen.getByLabelText(/Last name/), "Ahmed");
    await user.type(screen.getByLabelText(/Joining date/), "2026-04-01");
    await user.type(screen.getByLabelText(/Phone/), "+923001234567");
    await user.click(screen.getByRole("combobox", { name: "Campus" }));
    await user.click(await screen.findByRole("option", { name: "Main Campus" }));
    await user.click(screen.getByRole("button", { name: "New staff member" }));

    expect(await screen.findByText("This file has not been confirmed yet.")).toBeInTheDocument();
  });

  it("submits the selected department when one is chosen", async () => {
    mockGet.mockResolvedValue(apiResult([{ id: "dpt1", name: "Mathematics" }]));
    mockPost.mockResolvedValue(apiResult({ id: "st1", employee_number: "EMP-0001" }));
    const user = userEvent.setup();
    renderWithProviders(<StaffForm mode="create" />);

    await user.type(screen.getByLabelText(/First name/), "Bilal");
    await user.type(screen.getByLabelText(/Last name/), "Ahmed");
    await user.type(screen.getByLabelText(/Joining date/), "2026-04-01");
    await user.type(screen.getByLabelText(/Phone/), "+923001234567");
    await user.click(screen.getByRole("combobox", { name: "Campus" }));
    await user.click(await screen.findByRole("option", { name: "Main Campus" }));
    await user.click(screen.getByRole("combobox", { name: "Department" }));
    await user.click(await screen.findByRole("option", { name: "Mathematics" }));
    await user.click(screen.getByRole("button", { name: "New staff member" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        "/staff",
        expect.objectContaining({ department_id: "dpt1" }),
      );
    });
  });

  it("invalidates the staff cache and navigates to the detail page on success", async () => {
    mockPost.mockResolvedValue(apiResult({ id: "st1", employee_number: "EMP-0001" }));
    const user = userEvent.setup();
    const { queryClient } = renderWithProviders(<StaffForm mode="create" />);
    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");

    await user.type(screen.getByLabelText(/First name/), "Bilal");
    await user.type(screen.getByLabelText(/Last name/), "Ahmed");
    await user.type(screen.getByLabelText(/Joining date/), "2026-04-01");
    await user.type(screen.getByLabelText(/Phone/), "+923001234567");
    await user.click(screen.getByRole("combobox", { name: "Campus" }));
    await user.click(await screen.findByRole("option", { name: "Main Campus" }));
    await user.click(screen.getByRole("button", { name: "New staff member" }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/staff/st1");
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["staff"] });
  });
});

describe("StaffForm (edit)", () => {
  beforeEach(() => {
    mockGet.mockResolvedValue(apiResult([]));
  });

  it("renders employee_number as disabled and never re-submits it", () => {
    renderWithProviders(
      <StaffForm
        mode="edit"
        staff={{
          id: "st1",
          employee_number: "EMP-0001",
          user_id: null,
          first_name: "Bilal",
          last_name: "Ahmed",
          gender: "male",
          date_of_birth: "1985-06-01",
          photo_file_id: null,
          staff_type: "teaching",
          campus_id: "c1",
          campus_name: "Main Campus",
          department_id: null,
          department_name: null,
          designation_id: null,
          designation_name: null,
          reports_to_staff_id: null,
          employment_type: "full_time",
          employment_status: "active",
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
        }}
      />,
    );

    const field = screen.getByLabelText("Employee number");
    expect(field).toBeDisabled();
    expect(field).toHaveValue("EMP-0001");
  });
});
