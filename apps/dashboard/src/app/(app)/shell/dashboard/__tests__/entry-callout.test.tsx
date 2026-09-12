import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils";
import { Services } from "@/services";
import { EntryCallout } from "../entry-callout";

jest.mock("@/services", () => ({
  Services: { auth: { fetchCurrentUser: jest.fn() } },
}));

const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;

describe("EntryCallout", () => {
  beforeEach(() => {
    mockFetchCurrentUser.mockReset();
  });

  it("shows a skeleton while the user is in flight", () => {
    mockFetchCurrentUser.mockReturnValue(new Promise(() => undefined));
    const { container } = renderWithProviders(<EntryCallout />);

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Welcome back/)).not.toBeInTheDocument();
  });

  it("greets the signed-in user by name once loaded", async () => {
    mockFetchCurrentUser.mockResolvedValue({
      id: "u1",
      email: "owner@demo.localhost",
      phone: null,
      full_name: "School Admin Demo",
      avatar_url: null,
      locale: "en",
      tenant_id: "t1",
      roles: [],
      permissions: [],
    });

    renderWithProviders(<EntryCallout />);

    expect(await screen.findByText("Welcome back, School Admin Demo")).toBeInTheDocument();
  });
});
