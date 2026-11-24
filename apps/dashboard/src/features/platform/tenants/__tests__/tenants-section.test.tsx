import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { renderWithProviders, setUrl } from "@/test-utils";
import {
  ALL_PLATFORM_KEYS,
  apiError,
  onePage,
  platformUser,
  TENANT_ID,
  tenantRecord,
} from "@/features/platform/__tests__/platform-fixtures";

import { TenantsSection } from "../tenants-section";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

jest.mock("@/services", () =>
  jest
    .requireActual<{ platformServicesMock: () => unknown }>(
      "@/features/platform/__tests__/platform-services-mock",
    )
    .platformServicesMock(),
);

const auth = Services.auth as jest.Mocked<typeof Services.auth>;
const platform = Services.platform as jest.Mocked<typeof Services.platform>;

describe("TenantsSection", () => {
  beforeEach(() => {
    setUrl("/platform/tenants");
    auth.fetchCurrentUser.mockReset().mockResolvedValue(platformUser(ALL_PLATFORM_KEYS));
    platform.fetchTenantPage.mockReset().mockResolvedValue(
      onePage([
        tenantRecord(),
        tenantRecord({
          id: "0f1e2d3c-4b5a-4968-8776-655443322110",
          name: "Hill School",
          slug: "hill",
          status: "past_due",
        }),
      ]),
    );
    platform.createTenant.mockReset();
  });

  it("lists each school with its subdomain, readable status and a link to its page", async () => {
    renderWithProviders(<TenantsSection />);

    const row = (await screen.findByRole("link", { name: "City School" })).closest("tr");
    expect(row).not.toBeNull();
    expect(screen.getByRole("link", { name: "City School" })).toHaveAttribute(
      "href",
      `/platform/tenants/${TENANT_ID}`,
    );
    expect(within(row as HTMLElement).getByText("Trial")).toBeInTheDocument();
    expect(screen.getByText("Past due")).toBeInTheDocument();
  });

  it("reads the status filter from the URL and sends it to the API", async () => {
    setUrl("/platform/tenants?status=suspended");

    renderWithProviders(<TenantsSection />);

    await waitFor(() => {
      expect(platform.fetchTenantPage).toHaveBeenCalledWith(
        expect.objectContaining({ status: "suspended" }),
      );
    });
  });

  it("hides New school from an operator without platform.tenant.provision", async () => {
    auth.fetchCurrentUser.mockResolvedValue(platformUser(["platform.tenant.view"]));

    renderWithProviders(<TenantsSection />);

    await screen.findByRole("link", { name: "City School" });
    expect(screen.queryByRole("button", { name: "New school" })).not.toBeInTheDocument();
  });

  it("creates a school, showing the server's slug error under the field", async () => {
    platform.createTenant.mockRejectedValueOnce(
      apiError(400, "validation_error", "Invalid input.", {
        details: [{ field: "slug", issue: "A school with this slug already exists." }],
      }),
    );
    renderWithProviders(<TenantsSection />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "New school" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("School name"), "Lakeside School");
    await user.type(within(dialog).getByLabelText("Subdomain"), "lakeside");
    await user.type(within(dialog).getByLabelText("Contact name"), "Sara Malik");
    await user.type(within(dialog).getByLabelText("Contact email"), "sara@lakeside.test");
    await user.click(within(dialog).getByRole("button", { name: "Create school" }));

    expect(
      await within(dialog).findByText("A school with this slug already exists."),
    ).toBeInTheDocument();
    expect(platform.createTenant).toHaveBeenCalledWith({
      name: "Lakeside School",
      slug: "lakeside",
      contact_name: "Sara Malik",
      contact_email: "sara@lakeside.test",
      contact_phone: "",
    });
  });

  it("refuses a subdomain the server's pattern would refuse, before asking", async () => {
    renderWithProviders(<TenantsSection />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "New school" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("School name"), "Lakeside");
    await user.type(within(dialog).getByLabelText("Subdomain"), "Lake Side!");
    await user.type(within(dialog).getByLabelText("Contact name"), "Sara");
    await user.type(within(dialog).getByLabelText("Contact email"), "sara@lakeside.test");
    await user.click(within(dialog).getByRole("button", { name: "Create school" }));

    expect(
      await within(dialog).findByText(/use lowercase letters, digits and hyphens/i),
    ).toBeInTheDocument();
    expect(platform.createTenant).not.toHaveBeenCalled();
  });
});
