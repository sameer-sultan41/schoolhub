import { act, renderHook } from "@testing-library/react";

import { setUrl } from "@/test-utils";
import { useUrlParams } from "../use-url-params";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

describe("useUrlParams", () => {
  beforeEach(() => {
    setUrl("/students");
  });

  it("reads the current query string", () => {
    setUrl("/students?page=2&search=khan");

    const { result } = renderHook(() => useUrlParams());

    expect(result.current.searchParams.get("page")).toBe("2");
    expect(result.current.searchParams.get("search")).toBe("khan");
  });

  it("sets and deletes keys in place, keeping the path and adding no history entry", () => {
    setUrl("/students?page=2&search=khan");
    const historyLength = window.history.length;
    const { result } = renderHook(() => useUrlParams());

    act(() => {
      result.current.setParams({ page: null, sort: "-name" });
    });

    expect(window.location.pathname).toBe("/students");
    expect(window.location.search).toBe("?search=khan&sort=-name");
    expect(window.history.length).toBe(historyLength);
    expect(result.current.searchParams.get("sort")).toBe("-name");
    expect(result.current.searchParams.get("page")).toBeNull();
  });

  it("lands both of two writes made in the same tick", () => {
    const { result } = renderHook(() => useUrlParams());

    act(() => {
      result.current.setParams({ campus: "c" });
      result.current.setParams({ hidden: "status" });
    });

    expect(result.current.searchParams.get("campus")).toBe("c");
    expect(result.current.searchParams.get("hidden")).toBe("status");
  });

  it("leaves no trailing ? once the last key is deleted", () => {
    setUrl("/students?page=2");
    const { result } = renderHook(() => useUrlParams());

    act(() => {
      result.current.setParams({ page: null });
    });

    expect(window.location.href).toBe(`${window.location.origin}/students`);
  });

  it("writes nothing when the update changes nothing", () => {
    setUrl("/students?page=2");
    const { result } = renderHook(() => useUrlParams());
    const replaceState = jest.spyOn(window.history, "replaceState");

    try {
      act(() => {
        result.current.setParams({ page: "2", search: null });
      });

      expect(replaceState).not.toHaveBeenCalled();
    } finally {
      replaceState.mockRestore();
    }
  });
});
