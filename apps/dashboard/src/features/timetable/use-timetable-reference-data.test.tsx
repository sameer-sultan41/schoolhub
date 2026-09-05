import { collectPages } from "@schoolhub/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  useCampusOptions,
  usePeriodOptions,
  useRoomOptions,
  useSectionOptions,
  useSubjectOptions,
  useTeachingStaffOptions,
} from "@/features/timetable/use-timetable-reference-data";

jest.mock("@schoolhub/api-client", () => ({ collectPages: jest.fn() }));
// These hooks only need `apiClient` as an opaque value to hand to collectPages
// (mocked above, so it is never really called with it) — mock @/lib/auth
// directly, mirroring academics/use-academics-reference-data.test.tsx.
jest.mock("@/lib/auth", () => ({ apiClient: {} }));

const mockCollectPages = collectPages as jest.MockedFunction<typeof collectPages>;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("timetable reference data", () => {
  beforeEach(() => {
    mockCollectPages.mockReset();
    mockCollectPages.mockResolvedValue([]);
  });

  it("collects every period page — the grid's rows must be complete", async () => {
    const period = {
      id: "p1",
      campus_id: null,
      name: "Period 1",
      sequence: 1,
      start_time: "08:00:00",
      end_time: "08:40:00",
      is_break: false,
      weekdays: null,
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    };
    mockCollectPages.mockResolvedValue([period]);

    const { result } = renderHook(() => usePeriodOptions(), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([period]);
    expect(mockCollectPages.mock.calls[0]?.[1]).toBe("/periods");
  });

  it("asks only for rooms still in service", async () => {
    const { result } = renderHook(() => useRoomOptions(), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockCollectPages.mock.calls[0]?.[1]).toBe("/rooms");
    expect(mockCollectPages.mock.calls[0]?.[2]).toEqual({ query: { is_active: true } });
  });

  it("collects campuses, sections and subjects from their owning modules", async () => {
    const { result: campuses } = renderHook(() => useCampusOptions(), { wrapper });
    await waitFor(() => {
      expect(campuses.current.isSuccess).toBe(true);
    });
    expect(mockCollectPages.mock.calls[0]?.[1]).toBe("/campuses");

    mockCollectPages.mockClear();
    const { result: sections } = renderHook(() => useSectionOptions(), { wrapper });
    await waitFor(() => {
      expect(sections.current.isSuccess).toBe(true);
    });
    expect(mockCollectPages.mock.calls[0]?.[1]).toBe("/sections");

    mockCollectPages.mockClear();
    const { result: subjects } = renderHook(() => useSubjectOptions(), { wrapper });
    await waitFor(() => {
      expect(subjects.current.isSuccess).toBe(true);
    });
    expect(mockCollectPages.mock.calls[0]?.[1]).toBe("/subjects");
  });

  it("asks only for active teaching staff — the server refuses anything else", async () => {
    const { result } = renderHook(() => useTeachingStaffOptions(), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockCollectPages.mock.calls[0]?.[1]).toBe("/staff");
    expect(mockCollectPages.mock.calls[0]?.[2]).toEqual({
      query: { staff_type: "teaching", employment_status: "active" },
    });
  });
});
