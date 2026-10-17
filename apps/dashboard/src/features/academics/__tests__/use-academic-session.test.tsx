import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { Services, type AcademicSessionSummary } from "@/services";

import { useAcademicSession } from "../use-academic-session";

jest.mock("@/services", () => ({
  Services: { schoolOrganization: { fetchAcademicSessions: jest.fn() } },
}));

const mockFetchAcademicSessions = Services.schoolOrganization
  .fetchAcademicSessions as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchAcademicSessions
>;

const CURRENT: AcademicSessionSummary = {
  id: "sess-current",
  name: "2026-27",
  status: "active",
  is_current: true,
};
const PLANNED: AcademicSessionSummary = {
  id: "sess-planned",
  name: "2027-28",
  status: "planned",
  is_current: false,
};
const CLOSED: AcademicSessionSummary = {
  id: "sess-closed",
  name: "2025-26",
  status: "closed",
  is_current: false,
};
const ARCHIVED: AcademicSessionSummary = {
  id: "sess-archived",
  name: "2024-25",
  status: "archived",
  is_current: false,
};

/** One client for the whole test, so a refetch reads the same cache the first fetch wrote. */
function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function renderSession(urlSessionId: string, sessions: AcademicSessionSummary[]) {
  mockFetchAcademicSessions.mockResolvedValue(sessions);
  return renderHook(() => useAcademicSession(urlSessionId), { wrapper: makeWrapper() });
}

describe("useAcademicSession", () => {
  beforeEach(() => {
    mockFetchAcademicSessions.mockReset();
  });

  it("is loading, with no session yet, until the sessions arrive", async () => {
    const { result } = renderSession("", [CURRENT]);

    expect(result.current.isLoading).toBe(true);
    expect(result.current.session).toBeNull();
    expect(result.current.sessions).toBeUndefined();

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it("is not an error, and refetch is available, once the sessions load", async () => {
    const { result } = renderSession("", [CURRENT]);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.isError).toBe(false);
    expect(typeof result.current.refetch).toBe("function");
  });

  it("reports a failed fetch as an error, not as no session", async () => {
    mockFetchAcademicSessions.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useAcademicSession(""), { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.session).toBeNull();
    expect(result.current.sessions).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it("recovers once refetch succeeds after a failure", async () => {
    mockFetchAcademicSessions.mockRejectedValueOnce(new Error("down"));
    mockFetchAcademicSessions.mockResolvedValue([CURRENT]);
    const { result } = renderHook(() => useAcademicSession(""), { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.session).toEqual(CURRENT);
    });
    expect(result.current.isError).toBe(false);
  });

  it("resolves a URL id that exists, ahead of the current session", async () => {
    const { result } = renderSession(PLANNED.id, [CURRENT, PLANNED, CLOSED]);

    await waitFor(() => {
      expect(result.current.session).toEqual(PLANNED);
    });
    expect(result.current.sessions).toEqual([CURRENT, PLANNED, CLOSED]);
  });

  it("falls back to the current session when the URL names none", async () => {
    const { result } = renderSession("", [CLOSED, CURRENT]);

    await waitFor(() => {
      expect(result.current.session).toEqual(CURRENT);
    });
  });

  it("falls back to the current session when the URL id is not a known session", async () => {
    const { result } = renderSession("sess-unknown", [CLOSED, CURRENT]);

    await waitFor(() => {
      expect(result.current.session).toEqual(CURRENT);
    });
  });

  it("is null when no session is current and the URL names none", async () => {
    const { result } = renderSession("", [PLANNED, CLOSED]);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.session).toBeNull();
    expect(result.current.isLocked).toBe(false);
  });

  it("is not locked for the current or a planned session", async () => {
    const current = renderSession("", [CURRENT, PLANNED]);
    const planned = renderSession(PLANNED.id, [CURRENT, PLANNED]);

    await waitFor(() => {
      expect(current.result.current.session).toEqual(CURRENT);
      expect(planned.result.current.session).toEqual(PLANNED);
    });
    expect(current.result.current.isLocked).toBe(false);
    expect(planned.result.current.isLocked).toBe(false);
  });

  it.each([
    ["closed", CLOSED],
    ["archived", ARCHIVED],
  ])("is locked for a %s session", async (_status, locked) => {
    const { result } = renderSession(locked.id, [CURRENT, locked]);

    await waitFor(() => {
      expect(result.current.session).toEqual(locked);
    });
    expect(result.current.isLocked).toBe(true);
  });
});
