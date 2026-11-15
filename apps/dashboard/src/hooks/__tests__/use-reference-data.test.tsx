import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";

import {
  useAcademicSessions,
  useCampuses,
  useClasses,
  useDepartments,
  useSections,
  useSubjects,
} from "../use-reference-data";

jest.mock("@/services", () => ({
  Services: {
    dashboard: { fetchCampuses: jest.fn(), fetchDepartments: jest.fn() },
    schoolOrganization: {
      fetchClasses: jest.fn(),
      fetchSubjects: jest.fn(),
      fetchSections: jest.fn(),
      fetchAcademicSessions: jest.fn(),
    },
  },
}));

const mockFetchCampuses = Services.dashboard.fetchCampuses as jest.MockedFunction<
  typeof Services.dashboard.fetchCampuses
>;
const mockFetchDepartments = Services.dashboard.fetchDepartments as jest.MockedFunction<
  typeof Services.dashboard.fetchDepartments
>;
const mockFetchClasses = Services.schoolOrganization.fetchClasses as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchClasses
>;
const mockFetchSubjects = Services.schoolOrganization.fetchSubjects as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchSubjects
>;
const mockFetchSections = Services.schoolOrganization.fetchSections as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchSections
>;

const mockFetchAcademicSessions = Services.schoolOrganization
  .fetchAcademicSessions as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchAcademicSessions
>;

const CAMPUSES = [{ id: "campus-1", name: "Main Campus" }];
const OPTIONS = [{ id: "option-1", name: "Grade 1" }];
const SECTION_OPTIONS = [{ id: "section-1", name: "A", campus_id: "campus-1" }];
const CLASS_ID = "class-1";

/** A client the test can read back, so a key is checked as the cache sees it. */
function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { queryClient, wrapper };
}

/** What the cache holds under the key a reference list is read with. */
function cached(queryClient: QueryClient, resource: string, params?: Record<string, unknown>) {
  return queryClient.getQueryData(queryKeys.list("school-organization", resource, params));
}

describe("use-reference-data", () => {
  beforeEach(() => {
    mockFetchCampuses.mockReset().mockResolvedValue(CAMPUSES);
    mockFetchDepartments.mockReset().mockResolvedValue(OPTIONS);
    mockFetchClasses.mockReset().mockResolvedValue(OPTIONS);
    mockFetchSubjects.mockReset().mockResolvedValue(OPTIONS);
    mockFetchSections.mockReset().mockResolvedValue(SECTION_OPTIONS);
    mockFetchAcademicSessions.mockReset().mockResolvedValue([]);
  });

  it("useAcademicSessions reads the sessions under the key every other reader of that list uses", async () => {
    const { queryClient, wrapper } = setup();

    const { result } = renderHook(() => useAcademicSessions(), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(cached(queryClient, "academic-sessions")).toEqual([]);
  });

  it("useAcademicSessions waits while disabled", () => {
    const { wrapper } = setup();

    renderHook(() => useAcademicSessions({ enabled: false }), { wrapper });

    expect(mockFetchAcademicSessions).not.toHaveBeenCalled();
  });

  describe("useCampuses", () => {
    it("reads the campuses under the key every reader of them shares", async () => {
      const { queryClient, wrapper } = setup();

      const { result } = renderHook(() => useCampuses(), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(result.current.data).toEqual(CAMPUSES);
      expect(cached(queryClient, "campuses")).toEqual(CAMPUSES);
    });

    it("asks for nothing while disabled", () => {
      const { wrapper } = setup();

      const { result } = renderHook(() => useCampuses({ enabled: false }), { wrapper });

      expect(result.current.fetchStatus).toBe("idle");
      expect(mockFetchCampuses).not.toHaveBeenCalled();
    });

    it("asks for only the active campuses with isActive, under their own key", async () => {
      const { queryClient, wrapper } = setup();

      const { result } = renderHook(() => useCampuses({ isActive: true }), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(mockFetchCampuses).toHaveBeenCalledWith({ isActive: true });
      expect(cached(queryClient, "campuses", { isActive: true })).toEqual(CAMPUSES);
      expect(cached(queryClient, "campuses")).toBeUndefined();
    });
  });

  it("useDepartments reads the departments under the key the staff form shares", async () => {
    const { queryClient, wrapper } = setup();

    const { result } = renderHook(() => useDepartments(), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(cached(queryClient, "departments")).toEqual(OPTIONS);
  });

  describe("useClasses", () => {
    it("lists every class, active or not, when isActive is omitted", async () => {
      const { queryClient, wrapper } = setup();

      const { result } = renderHook(() => useClasses(), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(mockFetchClasses).toHaveBeenCalledTimes(1);
      expect(mockFetchClasses.mock.calls[0]?.[0]?.isActive).toBeUndefined();
      expect(cached(queryClient, "classes")).toEqual(OPTIONS);
    });

    it.each([true, false])("passes isActive=%s through, under its own key", async (isActive) => {
      const { queryClient, wrapper } = setup();

      const { result } = renderHook(() => useClasses({ isActive }), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(mockFetchClasses).toHaveBeenCalledWith({ isActive });
      expect(cached(queryClient, "classes", { isActive })).toEqual(OPTIONS);
      expect(cached(queryClient, "classes")).toBeUndefined();
    });

    it("asks for nothing while disabled", () => {
      const { wrapper } = setup();

      const { result } = renderHook(() => useClasses({ enabled: false }), { wrapper });

      expect(result.current.fetchStatus).toBe("idle");
      expect(mockFetchClasses).not.toHaveBeenCalled();
    });
  });

  describe("useSubjects", () => {
    it("lists every subject when isActive is omitted", async () => {
      const { queryClient, wrapper } = setup();

      const { result } = renderHook(() => useSubjects(), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(mockFetchSubjects).toHaveBeenCalledTimes(1);
      expect(mockFetchSubjects.mock.calls[0]?.[0]?.isActive).toBeUndefined();
      expect(cached(queryClient, "subjects")).toEqual(OPTIONS);
    });

    it("passes isActive through, under its own key", async () => {
      const { queryClient, wrapper } = setup();

      const { result } = renderHook(() => useSubjects({ isActive: true }), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(mockFetchSubjects).toHaveBeenCalledWith({ isActive: true });
      expect(cached(queryClient, "subjects", { isActive: true })).toEqual(OPTIONS);
      expect(cached(queryClient, "subjects")).toBeUndefined();
    });
  });

  describe("useSections", () => {
    it("reads one class's sections under a key naming the class", async () => {
      const { queryClient, wrapper } = setup();

      const { result } = renderHook(() => useSections(CLASS_ID), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(mockFetchSections).toHaveBeenCalledWith({ classId: CLASS_ID });
      expect(cached(queryClient, "sections", { classId: CLASS_ID })).toEqual(SECTION_OPTIONS);
    });

    it("passes isActive through, under its own key", async () => {
      const { queryClient, wrapper } = setup();

      const { result } = renderHook(() => useSections(CLASS_ID, { isActive: true }), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(mockFetchSections).toHaveBeenCalledWith({ classId: CLASS_ID, isActive: true });
      expect(cached(queryClient, "sections", { classId: CLASS_ID, isActive: true })).toEqual(
        SECTION_OPTIONS,
      );
      expect(cached(queryClient, "sections", { classId: CLASS_ID })).toBeUndefined();
    });

    it("asks for nothing until a class is chosen", () => {
      const { wrapper } = setup();

      const { result } = renderHook(() => useSections(""), { wrapper });

      expect(result.current.fetchStatus).toBe("idle");
      expect(mockFetchSections).not.toHaveBeenCalled();
    });
  });
});
