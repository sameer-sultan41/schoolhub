import { ApiError } from "@schoolhub/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { EmergencyContactsPanel } from "@/features/students/emergency-contacts-panel";
import { usePermission } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";

jest.mock("@/lib/auth", () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock("@/hooks/use-session", () => ({
  usePermission: jest.fn(() => false),
  useAnyPermission: jest.fn(() => false),
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

const CONTACT = {
  id: "ec1",
  student_id: "s1",
  name: "Ayesha Bibi",
  relationship: "aunt",
  phone: "+923001234567",
  alt_phone: null,
  priority: 1,
  notes: null,
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
};

describe("EmergencyContactsPanel", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockUsePermission.mockReturnValue(false);
  });

  it("renders the empty state when there are no emergency contacts", async () => {
    mockGet.mockResolvedValue(apiResult([]));

    renderWithProviders(<EmergencyContactsPanel studentId="s1" />);

    expect(await screen.findByText("No emergency contacts added yet.")).toBeInTheDocument();
  });

  it("renders a contact's name, relationship, phone, and priority", async () => {
    mockGet.mockResolvedValue(apiResult([CONTACT]));

    renderWithProviders(<EmergencyContactsPanel studentId="s1" />);

    expect(await screen.findByText("Ayesha Bibi")).toBeInTheDocument();
    expect(screen.getByText(/aunt/)).toBeInTheDocument();
    expect(screen.getByText("Priority 1")).toBeInTheDocument();
  });

  it("renders the ApiError envelope when the contacts query fails", async () => {
    mockGet.mockRejectedValue(
      new ApiError({ code: "server_error", message: "boom", status: 500, url: "/x" }),
    );

    renderWithProviders(<EmergencyContactsPanel studentId="s1" />);

    expect(await screen.findByText(/went wrong on our side/i)).toBeInTheDocument();
  });

  it("renders a contact's alternate phone and notes when present", async () => {
    mockGet.mockResolvedValue(
      apiResult([{ ...CONTACT, alt_phone: "+923009999999", notes: "Lives nearby" }]),
    );

    renderWithProviders(<EmergencyContactsPanel studentId="s1" />);

    expect(await screen.findByText(/\+923009999999/)).toBeInTheDocument();
    expect(screen.getByText("Lives nearby")).toBeInTheDocument();
  });

  it("adds a new emergency contact from the dialog", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(apiResult([]));
    mockPost.mockResolvedValue(apiResult({}));

    const user = userEvent.setup();
    renderWithProviders(<EmergencyContactsPanel studentId="s1" />);

    await user.click(await screen.findByRole("button", { name: "Add contact" }));
    await user.type(screen.getByLabelText("Name"), "Ayesha Bibi");
    await user.type(screen.getByLabelText("Relationship"), "aunt");
    await user.type(screen.getByLabelText("Phone"), "+923001234567");
    await user.type(screen.getByLabelText("Alternate phone"), "+923009999999");
    await user.type(screen.getByLabelText("Notes"), "Lives nearby");

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Add contact" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/students/s1/emergency-contacts", {
        name: "Ayesha Bibi",
        relationship: "aunt",
        phone: "+923001234567",
        alt_phone: "+923009999999",
        priority: 1,
        notes: "Lives nearby",
      });
    });
  });

  it("shows an error inside the dialog when adding a contact fails", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(apiResult([]));
    mockPost.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: "invalid",
        status: 400,
        url: "/students/s1/emergency-contacts",
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<EmergencyContactsPanel studentId="s1" />);

    await user.click(await screen.findByRole("button", { name: "Add contact" }));
    await user.type(screen.getByLabelText("Name"), "Ayesha Bibi");
    await user.type(screen.getByLabelText("Relationship"), "aunt");
    await user.type(screen.getByLabelText("Phone"), "+923001234567");

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Add contact" }));

    expect(await within(dialog).findByText(/correct the highlighted fields/i)).toBeInTheDocument();
  });
});
