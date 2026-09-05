import { collectPages } from "@schoolhub/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  useSections,
  useSubjects,
  useTeachingStaff,
} from "@/features/academics/use-academics-reference-data";

jest.mock("@schoolhub/api-client", () => ({ collectPages: jest.fn() }));
// These hooks only need `apiClient` as an opaque value to hand to collectPages
// (mocked above, so it is never really called with it) — mock @/lib/auth
// directly, mirroring staff/use-designations.test.tsx.
jest.mock("@/lib/auth", () => ({ apiClient: {} }));

const mockCollectPages = collectPages as jest.MockedFunction<typeof collectPages>;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("academics reference data", () => {
  beforeEach(() => {
    mockCollectPages.mockReset();
  });

  it("collects every subject page", async () => {
    const subject = { id: "sub1", name: "Mathematics", code: "MATH", is_active: true };
    mockCollectPages.mockResolvedValue([subject]);

    const { result } = renderHook(() => useSubjects(), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([subject]);
    expect(mockCollectPages.mock.calls[0]?.[1]).toBe("/subjects");
  });

  it("collects every section across classes", async () => {
    mockCollectPages.mockResolvedValue([]);

    const { result } = renderHook(() => useSections(), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockCollectPages.mock.calls[0]?.[1]).toBe("/sections");
  });

  it("asks only for active teaching staff", async () => {
    mockCollectPages.mockResolvedValue([]);

    const { result } = renderHook(() => useTeachingStaff(), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockCollectPages.mock.calls[0]?.[1]).toBe("/staff");
    expect(mockCollectPages.mock.calls[0]?.[2]).toEqual({
      query: { staff_type: "teaching", employment_status: "active" },
    });
  });
});
