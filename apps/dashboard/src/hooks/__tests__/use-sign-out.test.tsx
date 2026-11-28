import { act } from "@testing-library/react";

import { accessTokenStore } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import { impersonationToken } from "@/test-fixtures/impersonation";
import { buildUser, renderHookWithClient } from "@/test-utils";

import { useSignOut } from "../use-sign-out";

const mockReplace = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock("@/services", () => ({
  Services: { auth: { logout: jest.fn() } },
}));

const mockLogout = Services.auth.logout as jest.MockedFunction<typeof Services.auth.logout>;

describe("useSignOut", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockLogout.mockReset();
  });

  it("signing out clears the cached user", async () => {
    mockLogout.mockResolvedValue(undefined);
    const { result, queryClient } = renderHookWithClient(() => useSignOut());
    queryClient.setQueryData(queryKeys.currentUser(), buildUser([]));

    await act(async () => {
      result.current();
      await Promise.resolve();
    });

    expect(queryClient.getQueryData(queryKeys.currentUser())).toBeUndefined();
    expect(mockReplace).toHaveBeenCalledWith("/login");
  });

  it("still clears the cache and reaches /login when logout fails unexpectedly", async () => {
    mockLogout.mockRejectedValue(new Error("boom"));
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    const { result, queryClient } = renderHookWithClient(() => useSignOut());
    queryClient.setQueryData(queryKeys.currentUser(), buildUser([]));

    await act(async () => {
      result.current();
      await Promise.resolve();
    });

    expect(queryClient.getQueryData(queryKeys.currentUser())).toBeUndefined();
    expect(mockReplace).toHaveBeenCalledWith("/login");
  });

  it("signing out of an impersonated session lands on the ended page, not sign-in", async () => {
    mockLogout.mockResolvedValue(undefined);
    accessTokenStore.set(impersonationToken(), 1800);
    try {
      const { result } = renderHookWithClient(() => useSignOut());

      await act(async () => {
        result.current();
        await Promise.resolve();
      });

      expect(mockLogout).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith("/impersonate?ended=1");
    } finally {
      accessTokenStore.clear();
    }
  });
});
