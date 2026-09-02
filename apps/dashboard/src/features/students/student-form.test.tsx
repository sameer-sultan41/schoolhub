import { ApiError } from "@schoolhub/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { StudentForm } from "@/features/students/student-form";
import { apiClient } from "@/lib/auth";

jest.mock("@/lib/auth", () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
}));
jest.mock("@/features/students/use-reference-data", () => ({
  useCampuses: () => ({ data: [{ id: "c1", name: "Main Campus", code: "MAIN" }] }),
  useHouses: () => ({ data: [{ id: "h1", name: "Falcon" }] }),
}));

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

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

describe("StudentForm (create)", () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPush.mockReset();
  });

  it("shows a required-field message when submitting empty", async () => {
    const user = userEvent.setup();
    renderWithProviders(<StudentForm mode="create" />);

    await user.click(screen.getByRole("button", { name: "New student" }));

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
        url: "/students",
        details: [{ field: "first_name", issue: "A student with this name already exists." }],
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<StudentForm mode="create" />);

    await user.type(screen.getByLabelText(/First name/), "Amina");
    await user.type(screen.getByLabelText(/Last name/), "Khan");
    await user.type(screen.getByLabelText(/Date of birth/), "2015-06-01");
    await user.type(screen.getByLabelText(/Admission date/), "2026-04-01");
    await user.click(screen.getByRole("combobox", { name: "Campus" }));
    await user.click(await screen.findByRole("option", { name: "Main Campus" }));
    await user.click(screen.getByRole("button", { name: "New student" }));

    expect(await screen.findByText("A student with this name already exists.")).toBeInTheDocument();
  });

  it("invalidates the students cache and navigates to the detail page on success", async () => {
    mockPost.mockResolvedValue(apiResult({ id: "s1", admission_number: "2026-0001" }));
    const user = userEvent.setup();
    const { queryClient } = renderWithProviders(<StudentForm mode="create" />);
    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");

    await user.type(screen.getByLabelText(/First name/), "Amina");
    await user.type(screen.getByLabelText(/Last name/), "Khan");
    await user.type(screen.getByLabelText(/Date of birth/), "2015-06-01");
    await user.type(screen.getByLabelText(/Admission date/), "2026-04-01");
    await user.click(screen.getByRole("combobox", { name: "Campus" }));
    await user.click(await screen.findByRole("option", { name: "Main Campus" }));
    await user.click(screen.getByRole("button", { name: "New student" }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/students/s1");
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["students"] });
  });
});

describe("StudentForm (edit)", () => {
  it("renders admission_number as disabled and never re-submits it", () => {
    renderWithProviders(
      <StudentForm
        mode="edit"
        student={{
          id: "s1",
          admission_number: "2026-0001",
          user_id: null,
          first_name: "Amina",
          last_name: "Khan",
          preferred_name: null,
          date_of_birth: "2015-06-01",
          gender: "female",
          photo_file_id: null,
          campus_id: "c1",
          house_id: null,
          status: "active",
          admission_date: "2026-04-01",
          blood_group: null,
          nationality: null,
          religion: null,
          previous_school: null,
          address: null,
          custom_fields: {},
          created_at: "2026-04-01T00:00:00Z",
          updated_at: "2026-04-01T00:00:00Z",
        }}
      />,
    );

    const field = screen.getByLabelText("Admission number");
    expect(field).toBeDisabled();
    expect(field).toHaveValue("2026-0001");
  });
});
