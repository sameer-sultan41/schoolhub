import { collectPages } from "@schoolhub/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useDesignations } from "@/features/staff/use-designations";

jest.mock("@schoolhub/api-client", () => ({ collectPages: jest.fn() }));
// use-designations.ts only needs `apiClient` as an opaque value to pass through to
// collectPages (mocked above, so it's never actually called with it) — mock @/lib/auth
// directly rather than letting the real module load, mirroring
// students/use-reference-data.test.tsx's identical comment for why.
jest.mock("@/lib/auth", () => ({ apiClient: {} }));

const mockCollectPages = collectPages as jest.MockedFunction<typeof collectPages>;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useDesignations", () => {
  beforeEach(() => {
    mockCollectPages.mockReset();
  });

  it("resolves with every designation collected across pages", async () => {
    const designation = {
      id: "d1",
      name: "Senior Teacher",
      code: "SR-TCH",
      description: null,
      level: 2,
      is_active: true,
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    };
    mockCollectPages.mockResolvedValue([designation]);
    const { result } = renderHook(() => useDesignations(), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([designation]);
    expect(mockCollectPages.mock.calls[0]?.[1]).toBe("/designations");
  });
});
