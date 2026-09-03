import { collectPages } from "@schoolhub/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useCampuses, useHouses } from "@/features/students/use-reference-data";

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
