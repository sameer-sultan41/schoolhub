import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { GuardiansPanel } from "@/features/students/guardians-panel";
import { usePermission } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";

jest.mock("@/lib/auth", () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
}));
jest.mock("@/hooks/use-session", () => ({
  usePermission: jest.fn(() => false),
  useAnyPermission: jest.fn(() => false),
}));

// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockPatch = apiClient.patch as jest.MockedFunction<typeof apiClient.patch>;
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

const LINK = {
  id: "link1",
  student_id: "s1",
  guardian_id: "g1",
  relationship: "father" as const,
  is_primary: true,
  is_fee_responsible: true,
  can_pick_up: true,
  receives_communications: false,
  has_portal_access: false,
  access_revoked_reason: null,
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
};

const GUARDIAN = {
  id: "g1",
  user_id: null,
  first_name: "Bilal",
  last_name: "Khan",
  phone: "+923001234567",
  alt_phone: null,
  email: null,
  occupation: null,
  employer: null,
  national_id: null,
  photo_file_id: null,
  address: null,
  custom_fields: {},
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
};

describe("GuardiansPanel", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockUsePermission.mockReturnValue(false);
  });

  it("renders the empty state when the student has no linked guardians", async () => {
    mockGet.mockResolvedValue(apiResult([]));

    renderWithProviders(<GuardiansPanel studentId="s1" />);

    expect(await screen.findByText("No guardians linked yet.")).toBeInTheDocument();
  });

  it("renders a linked guardian with its relationship, flags, and primary badge", async () => {
    mockGet.mockImplementation((path: string) => {
      if (path === "/students/s1/guardians") return Promise.resolve(apiResult([LINK]));
      if (path === "/guardians/g1") return Promise.resolve(apiResult(GUARDIAN));
      throw new Error(`unexpected path ${path}`);
    });

    renderWithProviders(<GuardiansPanel studentId="s1" />);

    expect(await screen.findByText("Bilal Khan")).toBeInTheDocument();
    expect(screen.getByText(/Father/)).toBeInTheDocument();
    expect(screen.getByText("Primary")).toBeInTheDocument();
    expect(screen.getByText("Fee responsible")).toBeInTheDocument();
    expect(screen.getByText("Can pick up")).toBeInTheDocument();
    expect(screen.queryByText("Portal access")).not.toBeInTheDocument();
  });

  it("promotes a non-primary link to primary when 'Make primary' is clicked", async () => {
    mockUsePermission.mockReturnValue(true);
    const secondaryLink = { ...LINK, id: "link2", is_primary: false };
    mockGet.mockImplementation((path: string) => {
      if (path === "/students/s1/guardians") return Promise.resolve(apiResult([secondaryLink]));
      if (path === "/guardians/g1") return Promise.resolve(apiResult(GUARDIAN));
      throw new Error(`unexpected path ${path}`);
    });
    mockPatch.mockResolvedValue(apiResult({ ...secondaryLink, is_primary: true }));

    const user = userEvent.setup();
    renderWithProviders(<GuardiansPanel studentId="s1" />);

    const button = await screen.findByRole("button", { name: "Make primary" });
    await user.click(button);

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith("/student-guardians/link2", { is_primary: true });
    });
  });

  it("links a newly created guardian from the dialog", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(apiResult([]));
    mockPost.mockImplementation((path: string) => {
      if (path === "/guardians") return Promise.resolve(apiResult({ ...GUARDIAN, id: "g2" }));
      if (path === "/students/s1/guardians") return Promise.resolve(apiResult({}));
      throw new Error(`unexpected path ${path}`);
    });

    const user = userEvent.setup();
    renderWithProviders(<GuardiansPanel studentId="s1" />);

    await user.click(await screen.findByRole("button", { name: "Link guardian" }));
    await user.click(screen.getByRole("button", { name: "Create new" }));
    await user.type(screen.getByLabelText("First name"), "Amina");
    await user.type(screen.getByLabelText("Last name"), "Rahman");
    await user.type(screen.getByLabelText("Phone"), "+923009876543");

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Link guardian" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/guardians", {
        first_name: "Amina",
        last_name: "Rahman",
        phone: "+923009876543",
      });
    });
    expect(mockPost).toHaveBeenCalledWith("/students/s1/guardians", {
      guardian_id: "g2",
      relationship: "father",
    });
  });

  it("finds, selects, and links an existing guardian with the chosen relationship", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockImplementation((path: string) => {
      if (path === "/students/s1/guardians") return Promise.resolve(apiResult([]));
      if (path === "/guardians") {
        return Promise.resolve(apiResult([{ ...GUARDIAN, id: "g3", first_name: "Sara" }]));
      }
      throw new Error(`unexpected path ${path}`);
    });
    mockPost.mockResolvedValue(apiResult({}));

    const user = userEvent.setup();
    renderWithProviders(<GuardiansPanel studentId="s1" />);

    await user.click(await screen.findByRole("button", { name: "Link guardian" }));
    // Default tab is already "search" — switch away and back so the "Search
    // existing" tab button's own onClick runs too, not just the initial state.
    await user.click(screen.getByRole("button", { name: "Create new" }));
    await user.click(screen.getByRole("button", { name: "Search existing" }));

    await user.type(screen.getByPlaceholderText("Search by name or phone"), "Sara");

    const result = await screen.findByRole("button", { name: /Sara Khan/ }, { timeout: 2000 });
    await user.click(result);

    await user.click(screen.getByLabelText("Relationship"));
    await user.click(await screen.findByRole("option", { name: "Mother" }));

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Link guardian" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/students/s1/guardians", {
        guardian_id: "g3",
        relationship: "mother",
      });
    });
  }, 10000);
});
