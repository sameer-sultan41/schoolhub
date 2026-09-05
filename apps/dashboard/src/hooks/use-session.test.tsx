import type * as ApiClientModule from "@schoolhub/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { makeUser } from "@/test-utils";
import { restoreSession } from "@/lib/auth";
import { useAnyPermission, usePermission, useSession } from "./use-session";

jest.mock("@/lib/auth", () => ({
  restoreSession: jest.fn(),
}));

const mockRestoreSession = restoreSession as jest.MockedFunction<typeof restoreSession>;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useSession", () => {
  beforeEach(() => {
    mockRestoreSession.mockReset();
  });

  it("starts loading and unauthenticated", () => {
    mockRestoreSession.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useSession(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it("retries a transient failure rather than treating it as signed out", async () => {
    // useSession passes the shared retry policy explicitly, which overrides the client
    // default below — a throttled or unavailable refresh is exactly the case worth
    // retrying, and reporting it as "no session" would drop the user at /login.
    const { ApiError } = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
    const user = makeUser();
    mockRestoreSession
      .mockRejectedValueOnce(
        new ApiError({ code: "rate_limited", message: "slow down", status: 429, url: "/x" }),
      )
      .mockResolvedValueOnce(user);

    const { result } = renderHook(() => useSession(), { wrapper });

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });
    expect(mockRestoreSession).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the session is genuinely over", async () => {
    mockRestoreSession.mockResolvedValue(null);

    const { result } = renderHook(() => useSession(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(mockRestoreSession).toHaveBeenCalledTimes(1);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("exposes the restored user once loaded", async () => {
    mockRestoreSession.mockResolvedValue(makeUser({ permissions: ["fees.invoice.create"] }));
    const { result } = renderHook(() => useSession(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.id).toBe("u1");
  });

  it("stays unauthenticated when there is no session", async () => {
    mockRestoreSession.mockResolvedValue(null);
    const { result } = renderHook(() => useSession(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });
});

describe("usePermission", () => {
  beforeEach(() => {
    mockRestoreSession.mockReset();
  });

  it("reflects the loaded user's permissions", async () => {
    mockRestoreSession.mockResolvedValue(makeUser({ permissions: ["fees.invoice.create"] }));
    const { result } = renderHook(() => usePermission("fees.invoice.create"), { wrapper });

    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });

  it("is false before the session resolves", () => {
    mockRestoreSession.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => usePermission("fees.invoice.create"), { wrapper });

    expect(result.current).toBe(false);
  });
});

describe("useAnyPermission", () => {
  it("is true when the user holds at least one of the listed permissions", async () => {
    mockRestoreSession.mockResolvedValue(makeUser({ permissions: ["fees.invoice.create"] }));
    const { result } = renderHook(
      () => useAnyPermission(["library.book.issue", "fees.invoice.create"]),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });
});
