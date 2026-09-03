import { collectPages } from "@schoolhub/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  useAcademicSessions,
  useCampuses,
  useClasses,
  useHouses,
  useSectionsForClass,
} from "@/features/students/use-reference-data";

jest.mock("@schoolhub/api-client", () => ({ collectPages: jest.fn() }));
// use-reference-data.ts only needs `apiClient` as an opaque value to pass through to
// collectPages (mocked above, so it's never actually called with it) — mock @/lib/auth
// directly rather than letting the real module load. The real one calls createApiClient(),
// which does `globalThis.fetch.bind(globalThis)`; this jsdom test environment has no
// global fetch, so that throws the moment the real module is evaluated.
jest.mock("@/lib/auth", () => ({ apiClient: {} }));

const mockCollectPages = collectPages as jest.MockedFunction<typeof collectPages>;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useCampuses", () => {
  beforeEach(() => {
    mockCollectPages.mockReset();
  });

  it("resolves with every campus collected across pages", async () => {
    mockCollectPages.mockResolvedValue([{ id: "c1", name: "Main Campus", code: "MAIN" }]);
    const { result } = renderHook(() => useCampuses(), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([{ id: "c1", name: "Main Campus", code: "MAIN" }]);
    expect(mockCollectPages.mock.calls[0]?.[1]).toBe("/campuses");
  });
});

describe("useHouses", () => {
  beforeEach(() => {
    mockCollectPages.mockReset();
  });

  it("resolves with every house collected across pages", async () => {
    mockCollectPages.mockResolvedValue([{ id: "h1", name: "Falcon House" }]);
    const { result } = renderHook(() => useHouses(), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([{ id: "h1", name: "Falcon House" }]);
    expect(mockCollectPages.mock.calls[0]?.[1]).toBe("/houses");
  });
});

describe("useAcademicSessions", () => {
  beforeEach(() => {
    mockCollectPages.mockReset();
  });

  it("resolves with every academic session collected across pages", async () => {
    const session = {
      id: "as1",
      name: "2026-2027",
      status: "active",
      start_date: "2026-04-01",
      end_date: "2027-03-31",
    };
    mockCollectPages.mockResolvedValue([session]);
    const { result } = renderHook(() => useAcademicSessions(), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([session]);
    expect(mockCollectPages.mock.calls[0]?.[1]).toBe("/academic-sessions");
  });
});

describe("useClasses", () => {
  beforeEach(() => {
    mockCollectPages.mockReset();
  });

  it("resolves with every class collected across pages", async () => {
    const schoolClass = { id: "cl1", name: "Grade 5", level: 5 };
    mockCollectPages.mockResolvedValue([schoolClass]);
    const { result } = renderHook(() => useClasses(), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([schoolClass]);
    expect(mockCollectPages.mock.calls[0]?.[1]).toBe("/classes");
  });
});

describe("useSectionsForClass", () => {
  beforeEach(() => {
    mockCollectPages.mockReset();
  });

  it("resolves with the sections for the given class", async () => {
    const section = { id: "sec1", name: "A", class_id: "cl1", campus_id: "c1", capacity: 30 };
    mockCollectPages.mockResolvedValue([section]);
    const { result } = renderHook(() => useSectionsForClass("cl1"), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([section]);
    expect(mockCollectPages.mock.calls[0]?.[2]).toEqual({ query: { class_id: "cl1" } });
  });

  it("does not query when there is no class id yet", () => {
    const { result } = renderHook(() => useSectionsForClass(undefined), { wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockCollectPages).not.toHaveBeenCalled();
  });
});
