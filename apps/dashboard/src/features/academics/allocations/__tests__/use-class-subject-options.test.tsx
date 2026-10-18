import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import { curriculumRecord } from "@/services/modules/curriculum/__tests__/curriculum-fixtures";
import { OTHER_SUBJECT_ID } from "@/services/modules/teacher-allocations/__tests__/teacher-allocations-fixtures";
import { CLASS_ID, SESSION_ID, SUBJECT_ID } from "@/test-fixtures/academics";

import { useClassSubjectOptions } from "../use-class-subject-options";

jest.mock("@/services", () => ({
  Services: { curriculum: { fetchCurriculumForClass: jest.fn() } },
}));

const mockFetchCurriculumForClass = Services.curriculum
  .fetchCurriculumForClass as jest.MockedFunction<
  typeof Services.curriculum.fetchCurriculumForClass
>;

/** A client the test can read back, so a key is checked as the cache sees it. */
function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { queryClient, wrapper };
}

describe("useClassSubjectOptions", () => {
  beforeEach(() => {
    mockFetchCurriculumForClass
      .mockReset()
      .mockResolvedValue([
        curriculumRecord(),
        curriculumRecord({ id: "c2", subject_id: OTHER_SUBJECT_ID, subject_name: "English" }),
      ]);
  });

  it("asks for nothing until a class is chosen", () => {
    const { wrapper } = setup();

    const { result } = renderHook(() => useClassSubjectOptions(SESSION_ID, ""), { wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockFetchCurriculumForClass).not.toHaveBeenCalled();
  });

  it("asks for the class's curriculum in the session and returns its subjects", async () => {
    const { wrapper } = setup();

    const { result } = renderHook(() => useClassSubjectOptions(SESSION_ID, CLASS_ID), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(mockFetchCurriculumForClass).toHaveBeenCalledWith(SESSION_ID, CLASS_ID);
    expect(result.current.data).toEqual([
      { id: SUBJECT_ID, name: "Mathematics" },
      { id: OTHER_SUBJECT_ID, name: "English" },
    ]);
  });

  it("offers a subject once when the curriculum maps it for several campuses", async () => {
    mockFetchCurriculumForClass.mockResolvedValue([
      curriculumRecord(),
      curriculumRecord({ id: "c2", campus_id: null, campus_name: null }),
    ]);
    const { wrapper } = setup();

    const { result } = renderHook(() => useClassSubjectOptions(SESSION_ID, CLASS_ID), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual([{ id: SUBJECT_ID, name: "Mathematics" }]);
  });

  it("holds the curriculum under the curriculum module, so a write refreshes it", async () => {
    const { queryClient, wrapper } = setup();

    const { result } = renderHook(() => useClassSubjectOptions(SESSION_ID, CLASS_ID), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    const cached = queryClient.getQueryData(
      queryKeys.list("curriculum", "for-class", {
        academicSessionId: SESSION_ID,
        classId: CLASS_ID,
      }),
    );
    expect(cached).toHaveLength(2);
    mockFetchCurriculumForClass.mockClear();

    await queryClient.invalidateQueries({ queryKey: queryKeys.module("curriculum") });

    await waitFor(() => {
      expect(mockFetchCurriculumForClass).toHaveBeenCalledTimes(1);
    });
  });
});
