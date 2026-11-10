import { screen, waitFor } from "@testing-library/react";

import { Services } from "@/services";
import { buildUser, renderWithProviders } from "@/test-utils";

import { AudienceGate } from "../audience-gate";

const mockReplace = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock("@/services", () => ({
  Services: { auth: { fetchCurrentUser: jest.fn() } },
}));

const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;

const restricted = { ...buildUser([]), is_restricted_principal: true };
const staff = { ...buildUser([]), is_restricted_principal: false };

describe("AudienceGate", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockFetchCurrentUser.mockReset();
  });

  it("restricted principal is redirected to the portal", async () => {
    mockFetchCurrentUser.mockResolvedValue(restricted);

    renderWithProviders(
      <AudienceGate audience="staff">
        <p>staff shell</p>
      </AudienceGate>,
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/portal");
    });
    expect(screen.queryByText("staff shell")).not.toBeInTheDocument();
  });

  it("staff user is redirected out of the portal", async () => {
    mockFetchCurrentUser.mockResolvedValue(staff);

    renderWithProviders(
      <AudienceGate audience="portal">
        <p>portal shell</p>
      </AudienceGate>,
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/dashboard");
    });
    expect(screen.queryByText("portal shell")).not.toBeInTheDocument();
  });

  it("renders nothing and does not redirect until /auth/me resolves", () => {
    mockFetchCurrentUser.mockReturnValue(new Promise(() => undefined));

    const { container } = renderWithProviders(
      <AudienceGate audience="portal">
        <p>portal shell</p>
      </AudienceGate>,
    );

    expect(container).toBeEmptyDOMElement();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("shows the portal to a restricted principal without redirecting", async () => {
    mockFetchCurrentUser.mockResolvedValue(restricted);

    renderWithProviders(
      <AudienceGate audience="portal">
        <p>portal shell</p>
      </AudienceGate>,
    );

    expect(await screen.findByText("portal shell")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("shows the staff shell to staff without redirecting", async () => {
    mockFetchCurrentUser.mockResolvedValue(staff);

    renderWithProviders(
      <AudienceGate audience="staff">
        <p>staff shell</p>
      </AudienceGate>,
    );

    expect(await screen.findByText("staff shell")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("shows the shell when /auth/me fails, rather than a blank page", async () => {
    mockFetchCurrentUser.mockRejectedValue(new Error("network"));

    renderWithProviders(
      <AudienceGate audience="staff">
        <p>staff shell</p>
      </AudienceGate>,
    );

    expect(await screen.findByText("staff shell")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
