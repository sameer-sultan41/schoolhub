import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { EnrollmentPanel } from "@/features/students/enrollment-panel";
import { usePermission } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";

jest.mock("@/lib/auth", () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock("@/hooks/use-session", () => ({
  usePermission: jest.fn(() => false),
  useAnyPermission: jest.fn(() => false),
}));
jest.mock("@/features/students/use-reference-data", () => ({
  useAcademicSessions: () => ({ data: [{ id: "sess1", name: "2026-27" }] }),
  useClasses: () => ({ data: [{ id: "class1", name: "Grade 6" }] }),
  useSectionsForClass: () => ({ data: [{ id: "section1", name: "A" }] }),
  useCampuses: () => ({ data: [] }),
}));

// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const mockUsePermission = usePermission as jest.MockedFunction<typeof usePermission>;

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

const ACTIVE_ENROLLMENT_EVENT = {
  type: "enrollment",
  id: "enr1",
  date: "2026-04-05",
  status: "active",
  academic_session_id: "sess1",
  academic_session_name: "2026-27",
  class_id: "class1",
  class_name: "Grade 6",
  section_id: "section1",
  section_name: "A",
  roll_number: "12",
};

describe("EnrollmentPanel", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockUsePermission.mockReturnValue(false);
  });

  it("renders the not-enrolled state when no active enrollment exists", async () => {
    mockGet.mockResolvedValue(apiResult([]));

    renderWithProviders(<EnrollmentPanel studentId="s1" />);

    expect(await screen.findByText("Not enrolled in an active session.")).toBeInTheDocument();
  });

  it("renders the active enrollment's status and roll number", async () => {
    mockGet.mockResolvedValue(apiResult([ACTIVE_ENROLLMENT_EVENT]));

    renderWithProviders(<EnrollmentPanel studentId="s1" />);

    expect(await screen.findByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Roll #12")).toBeInTheDocument();
  });

  it("enrolls the student from the dialog", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(apiResult([]));
    mockPost.mockResolvedValue(apiResult({}));

    const user = userEvent.setup();
    renderWithProviders(<EnrollmentPanel studentId="s1" />);

    await user.click(await screen.findByRole("button", { name: "Enroll" }));

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("combobox", { name: "Academic session" }));
    await user.click(await screen.findByRole("option", { name: "2026-27" }));
    await user.click(within(dialog).getByRole("combobox", { name: "Class" }));
    await user.click(await screen.findByRole("option", { name: "Grade 6" }));
    await user.click(within(dialog).getByRole("combobox", { name: "Section" }));
    await user.click(await screen.findByRole("option", { name: "A" }));
    await user.type(within(dialog).getByLabelText("Enrollment date"), "2026-04-05");
    await user.click(within(dialog).getByRole("button", { name: "Enroll" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/students/s1:enroll", {
        academic_session_id: "sess1",
        class_id: "class1",
        section_id: "section1",
        enrollment_date: "2026-04-05",
        roll_number: null,
        capacity_override_reason: null,
      });
    });
  });

  it("withdraws the student from the dialog", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(apiResult([ACTIVE_ENROLLMENT_EVENT]));
    mockPost.mockResolvedValue(apiResult({}));

    const user = userEvent.setup();
    renderWithProviders(<EnrollmentPanel studentId="s1" />);

    await user.click(await screen.findByRole("button", { name: "Withdraw" }));

    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason"), "Family relocation");
    await user.type(within(dialog).getByLabelText("Effective date"), "2026-06-01");
    await user.click(within(dialog).getByRole("button", { name: "Withdraw" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/students/s1:withdraw", {
        reason: "Family relocation",
        effective_date: "2026-06-01",
      });
    });
  });
});
