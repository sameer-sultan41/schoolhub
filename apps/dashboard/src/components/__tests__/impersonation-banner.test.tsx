import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useQuery } from "@tanstack/react-query";

import { accessTokenStore } from "@/lib/auth";
import { ApiError, Services } from "@/services";
import { impersonatedUser, impersonationToken, schoolToken } from "@/test-fixtures/impersonation";
import { renderWithProviders } from "@/test-utils";

import { ImpersonationBanner } from "../impersonation-banner";

const mockReplace = jest.fn();

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => Record<string, unknown> }>(
    "@/test-utils",
  );
  return { ...testUtils.createNavigationMock(), useRouter: () => ({ replace: mockReplace }) };
});
jest.mock("@/services", () =>
  jest
    .requireActual<{ servicesMock: (domains: Record<string, string[]>) => unknown }>(
      "@/test-fixtures/services-mock",
    )
    .servicesMock({
      auth: ["fetchCurrentUser", "endImpersonation", "forgetImpersonation"],
    }),
);

const auth = Services.auth as jest.Mocked<typeof Services.auth>;

const MINUTE = 60_000;

/** A read that the API refuses because the grant is gone, as any screen's query might be. */
function EndedRead({ status }: { status: number }) {
  useQuery({
    queryKey: ["some", "screen"],
    queryFn: () =>
      Promise.reject(
        new ApiError({ code: "impersonation_ended", message: "ended", status, url: "/students" }),
      ),
  });
  return null;
}

/** The banner follows the session's own token: its `amr` says whether it is an impersonation. */
function impersonating(active: boolean) {
  accessTokenStore.set(active ? impersonationToken() : schoolToken(), 1800);
}

describe("ImpersonationBanner", () => {
  beforeEach(() => {
    Object.values(auth).forEach((mock) => {
      mock.mockReset();
    });
    mockReplace.mockReset();
    accessTokenStore.clear();
    auth.endImpersonation.mockResolvedValue(undefined);
  });

  it("names who is impersonated, the operator and the time left", async () => {
    impersonating(true);
    const expiresAt = new Date(Date.now() + 25 * MINUTE).toISOString();
    auth.fetchCurrentUser.mockResolvedValue(impersonatedUser(expiresAt));
    renderWithProviders(<ImpersonationBanner />);

    const banner = await screen.findByRole("region", { name: "Support session" });
    await within(banner).findByText(/Ayesha Khan/);
    expect(banner).toHaveTextContent("Support Operator");
    expect(banner).toHaveTextContent("25 minutes left");
  });

  it("shows nothing for a normal session, whose token has no impersonation amr", () => {
    // Same user record as the test above: only the token differs.
    impersonating(false);
    auth.fetchCurrentUser.mockResolvedValue(
      impersonatedUser(new Date(Date.now() + 25 * MINUTE).toISOString()),
    );
    renderWithProviders(<ImpersonationBanner />);

    expect(screen.queryByRole("region", { name: "Support session" })).not.toBeInTheDocument();
    expect(auth.fetchCurrentUser).not.toHaveBeenCalled();
  });

  it("End session releases the grant and opens the ended page", async () => {
    impersonating(true);
    const expiresAt = new Date(Date.now() + 25 * MINUTE).toISOString();
    auth.fetchCurrentUser.mockResolvedValue(impersonatedUser(expiresAt));
    renderWithProviders(<ImpersonationBanner />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "End session" }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/impersonate?ended=1");
    });
    expect(auth.endImpersonation).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403])(
    "a %i impersonation_ended from any read ends the session and says so",
    async (status) => {
      impersonating(true);
      const expiresAt = new Date(Date.now() + 25 * MINUTE).toISOString();
      auth.fetchCurrentUser.mockResolvedValue(impersonatedUser(expiresAt));
      renderWithProviders(
        <>
          <ImpersonationBanner />
          <EndedRead status={status} />
        </>,
      );

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith("/impersonate?ended=1");
      });
      // The grant is already gone: the session is dropped here, with no request to end it.
      expect(auth.forgetImpersonation).toHaveBeenCalled();
      expect(auth.endImpersonation).not.toHaveBeenCalled();
    },
  );

  it("a grant past its time ends the session without waiting for a request", async () => {
    impersonating(true);
    const expiresAt = new Date(Date.now() - 1000).toISOString();
    auth.fetchCurrentUser.mockResolvedValue(impersonatedUser(expiresAt));
    renderWithProviders(<ImpersonationBanner />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/impersonate?ended=1");
    });
    expect(auth.forgetImpersonation).toHaveBeenCalled();
  });
});
